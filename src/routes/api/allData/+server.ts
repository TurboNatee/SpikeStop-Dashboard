import { InfluxDBClient } from '@influxdata/influxdb3-client';
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

// Read active alerts from InfluxDB esp32s create alerts now.
async function checkAndWriteAlerts(sensorData: Record<string, any>) {
  const alertClient = new InfluxDBClient({
    host: INFLUX_URL,
    token: INFLUX_ALERTS_TOKEN
  });

  const activeAlerts: Record<string, any> = {};

  try {
    const query = `
      SELECT node, delta, active, time
      FROM "alert"
      WHERE active == true AND time >= now() - interval '10 minutes'
      ORDER BY node, time DESC
    `;

    for await (const row of alertClient.query(query, INFLUX_ALERTS_DB)) {
      const mac = row.node;
      if (!activeAlerts[mac]) {
        activeAlerts[mac] = {
          delta: Number(row.delta),
          active: row.active === 'true' || row.active === true,
          _time: row.time
        };
      }
    }

    console.log(`Found ${Object.keys(activeAlerts).length} active alerts from ESP32 devices`);
  } finally {
    await alertClient.close();
  }

  return activeAlerts;
}
