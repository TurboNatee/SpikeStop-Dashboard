import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { json } from '@sveltejs/kit';
import {
  INFLUX_URL,
  INFLUX_SENSOR_TOKEN,
  INFLUX_ALERTS_TOKEN,
  INFLUX_SENSOR_DB,
  INFLUX_ALERTS_DB
} from '$env/static/private';

export async function GET() {
  try {
    const sensorData = await fetchSensorData();
    const alertData = await checkAndWriteAlerts(sensorData);

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

// Fetch last 10 readings per node and compute variance
async function fetchSensorData() {
  const query = `
    SELECT node, sensor_value, temperature, rssi, hops, time
    FROM "mesh_sensor"
    WHERE time >= now() - interval '2 minutes'
    ORDER BY node, time DESC
    LIMIT 100
  `;

  const latest: Record<string, any[]> = {};
  const client = new InfluxDBClient({
    host: INFLUX_URL,
    token: INFLUX_SENSOR_TOKEN
  });

  try {
    for await (const row of client.query(query, INFLUX_SENSOR_DB)) {
      const entry = {
        node: row.node,
        sensor_value: Number(row.sensor_value),
        temperature: Number(row.temperature),
        rssi: Number(row.rssi),
        hops: Number(row.hops),
        time: row.time
      };
      if (!latest[row.node]) latest[row.node] = [];
      latest[row.node].push(entry);
    }
  } finally {
    await client.close();
  }

  const reduced: Record<string, any> = {};
  for (const mac of Object.keys(latest)) {
    const readings = latest[mac].slice(0, 10);
    if (readings.length === 0) continue;

    const values = readings.map((r) => r.sensor_value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const latestVal = readings[0].sensor_value;
    const variance = latestVal - avg;

    reduced[mac] = {
      sensor_value: latestVal,
      temperature: readings[0].temperature,
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

// Check variance & write alerts (true if Δ > 50, false otherwise)
async function checkAndWriteAlerts(sensorData: Record<string, any>) {
  const alertClient = new InfluxDBClient({
    host: INFLUX_URL,
    token: INFLUX_ALERTS_TOKEN
  });

  const activeAlerts: Record<string, any> = {};
  const alertPoints: Point[] = [];

  try {
    for (const mac of Object.keys(sensorData)) {
      const data = sensorData[mac];
      const { avg, sensor_value, readings } = data;

      const deltas = readings.map((v: number) => Math.abs(v - avg));
      const maxDelta = Math.max(...deltas);

      const point = Point.measurement('alert')
        .setTag('node', mac)
        .setTag('type', 'turbidity_variance')
        .setFloatField('delta', maxDelta)
        .setFloatField('avg', avg)
        .setFloatField('latest', sensor_value)
        .setBooleanField('active', maxDelta > 50)
        .setTimestamp(new Date());

      alertPoints.push(point);

      activeAlerts[mac] = {
        delta: maxDelta,
        active: maxDelta > 50,
        _time: new Date().toISOString()
      };

      console.log(
        `${maxDelta > 50 ? 'Alert triggered' : 'Cleared alert'} for ${mac}: Δ=${maxDelta.toFixed(2)}`
      );
    }

    if (alertPoints.length > 0) {
      await alertClient.write(alertPoints, INFLUX_ALERTS_DB);
      console.log(`Wrote ${alertPoints.length} alert updates to InfluxDB`);
    }
  } finally {
    await alertClient.close();
  }

  return activeAlerts;
}
