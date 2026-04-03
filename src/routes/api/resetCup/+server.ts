import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const FACTORY_RESET_CODE = 991337;

export async function POST({ request }) {
  let node = '';

  try {
    const body = await request.json();
    node = String(body?.node ?? '').trim();
  } catch {
    return json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!node) {
    return json({ error: 'Missing node' }, { status: 400 });
  }

  const influxUrl = env.INFLUX_URL;
  const influxAlertsToken = env.INFLUX_ALERTS_TOKEN;
  const influxAlertsDb = env.INFLUX_ALERTS_DB;

  if (!influxUrl || !influxAlertsToken || !influxAlertsDb) {
    return json({ error: 'Server is missing InfluxDB configuration' }, { status: 500 });
  }

  const client = new InfluxDBClient({
    host: influxUrl,
    token: influxAlertsToken
  });

  try {
    const point = Point.measurement('command')
      .setTag('node', node)
      .setIntegerField('factory_reset_code', FACTORY_RESET_CODE)
      .setTimestamp(new Date());

    await client.write([point], influxAlertsDb);

    return json({ ok: true, node });
  } catch (error) {
    console.error('resetCup write error:', error);
    return json({ error: 'Failed to write reset command' }, { status: 500 });
  } finally {
    await client.close();
  }
}
