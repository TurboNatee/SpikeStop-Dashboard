import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';


function getRequiredEnv(name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

type InfluxConfig = {
  influxUrl: string;
  influxSensorToken: string;
  influxAlertsToken: string;
  influxSensorDb: string;
  influxAlertsDb: string;
};

function getInfluxConfig(): InfluxConfig {
  return {
    influxUrl: getRequiredEnv('INFLUX_URL'),
    influxSensorToken: getRequiredEnv('INFLUX_SENSOR_TOKEN'),
    influxAlertsToken: getRequiredEnv('INFLUX_ALERTS_TOKEN'),
    influxSensorDb: getRequiredEnv('INFLUX_SENSOR_DB'),
    influxAlertsDb: getRequiredEnv('INFLUX_ALERTS_DB')
  };
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type SensorReading = {
  node: string;
  sensor_value: number;
  temperature: number | null;
  battery_v: number | null;
  battery_pct: number | null;
  ir_signal_uv: number | null;
  ir_signal_uv_normalized: number | null;
  ir_signal_mv: number | null;
  ir_signal_mv_precise: number | null;
  ir_broken: number | null;
  rssi: number | null;
  hops: number | null;
  time: string;
};

type ReducedSensor = {
  sensor_value: number;
  temperature: number | null;
  battery_v: number | null;
  battery_pct: number | null;
  ir_signal_uv: number | null;
  ir_signal_uv_normalized: number | null;
  ir_signal_mv: number | null;
  ir_signal_mv_precise: number | null;
  ir_broken: number | null;
  rssi: number | null;
  hops: number | null;
  _time: string;
  avg: number;
  variance: number;
  readings: number[];
};

type ReducedSensorData = Record<string, ReducedSensor>;

type ActiveAlert = {
  delta: number;
  active: boolean;
  _time: string;
};

type ActiveAlerts = Record<string, ActiveAlert>;

export async function GET() {
  try {
    const config = getInfluxConfig();
    const sensorData = await fetchSensorData(config);
    const alertData = await checkAndWriteAlerts(sensorData, config);

    return json({
      sensorData,
      alertData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('allData error:', error);
    return json({ error: String(error) }, { status: 500 });
  }
}


async function fetchSensorData(config: InfluxConfig): Promise<ReducedSensorData> {
  const query = `
    SELECT node, sensor_value, temperature, battery_v, battery_pct, ir_signal_uv, ir_signal_mv, ir_broken, rssi, hops, time
    FROM "mesh_sensor"
    WHERE time >= now() - interval '2 minutes'
    ORDER BY node, time DESC
    LIMIT 100
  `;

  const latest: Record<string, SensorReading[]> = {};
  const client = new InfluxDBClient({
    host: config.influxUrl,
    token: config.influxSensorToken
  });

  try {
    for await (const row of client.query(query, config.influxSensorDb)) {
      const record = row as Record<string, unknown>;
      const node = String(record.node ?? '');
      if (!node) continue;

      const irSignalUv = toFiniteNumber(record.ir_signal_uv);
      const irSignalMv = toFiniteNumber(record.ir_signal_mv);
      const irSignalUvNormalized = irSignalUv ?? (irSignalMv !== null ? irSignalMv * 1000 : null);

      const entry: SensorReading = {
        node,
        sensor_value: toFiniteNumber(record.sensor_value) ?? 0,
        temperature: toFiniteNumber(record.temperature),
        battery_v: toFiniteNumber(record.battery_v),
        battery_pct: toFiniteNumber(record.battery_pct),
        ir_signal_uv: irSignalUv,
        ir_signal_uv_normalized: irSignalUvNormalized,
        ir_signal_mv: irSignalMv,
        ir_signal_mv_precise: irSignalUvNormalized !== null ? irSignalUvNormalized / 1000 : null,
        ir_broken: toFiniteNumber(record.ir_broken),
        rssi: toFiniteNumber(record.rssi),
        hops: toFiniteNumber(record.hops),
        time: String(record.time ?? '')
      };

      if (!latest[node]) latest[node] = [];
      latest[node].push(entry);
    }
  } finally {
    await client.close();
  }

  const reduced: ReducedSensorData = {};
  for (const mac of Object.keys(latest)) {
    const readings = latest[mac].slice(0, 30);
    if (readings.length === 0) continue;

    const values = readings.map((r) => r.sensor_value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const latestVal = readings[0].sensor_value;
    const variance = latestVal - avg;

    reduced[mac] = {
      sensor_value: latestVal,
      temperature: readings[0].temperature,
      battery_v: readings[0].battery_v,
      battery_pct: readings[0].battery_pct,
      ir_signal_uv: readings[0].ir_signal_uv,
      ir_signal_uv_normalized: readings[0].ir_signal_uv_normalized,
      ir_signal_mv: readings[0].ir_signal_mv,
      ir_signal_mv_precise: readings[0].ir_signal_mv_precise,
      ir_broken: readings[0].ir_broken,
      rssi: readings[0].rssi,
      hops: readings[0].hops,
      _time: readings[0].time,
      avg,
      variance,
      readings: values
    };
  }

  return reduced;
}


async function checkAndWriteAlerts(sensorData: ReducedSensorData, config: InfluxConfig): Promise<ActiveAlerts> {
  const alertClient = new InfluxDBClient({
    host: config.influxUrl,
    token: config.influxAlertsToken
  });

  const activeAlerts: ActiveAlerts = {};
  const alertPoints: Point[] = [];

  try {
    for (const mac of Object.keys(sensorData)) {
      const data = sensorData[mac];
      const { avg, sensor_value, readings } = data;

      const deltas = readings.map((v: number) => Math.abs(v - avg));
      const maxDelta = deltas.length > 0 ? Math.max(...deltas) : 0;

      const point = Point.measurement('alert')
        .setTag('node', mac)
        .setTag('type', 'turbidity_variance')
        .setFloatField('delta', maxDelta)
        .setFloatField('avg', avg)
        .setFloatField('latest', sensor_value)
        .setBooleanField('active', maxDelta >= 65)
        .setTimestamp(new Date());

      alertPoints.push(point);

      activeAlerts[mac] = {
        delta: maxDelta,
        active: maxDelta >= 65,
        _time: new Date().toISOString()
      };

      console.log(
        `${maxDelta >= 65 ? 'Alert triggered' : 'Cleared alert'} for ${mac}: Δ=${maxDelta.toFixed(2)}`
      );
    }

    if (alertPoints.length > 0) {
      await alertClient.write(alertPoints, config.influxAlertsDb);
      console.log(`Wrote ${alertPoints.length} alert updates to InfluxDB`);
    }
  } finally {
    await alertClient.close();
  }

  return activeAlerts;
}
