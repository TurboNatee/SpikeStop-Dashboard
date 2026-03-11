import { InfluxDBClient, Point } from '@influxdata/influxdb3-client';
import { json } from '@sveltejs/kit';
import { INFLUX_URL, INFLUX_ALERTS_TOKEN, INFLUX_ALERTS_DB } from '$env/static/private';

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

  const client = new InfluxDBClient({
    host: INFLUX_URL,
    token: INFLUX_ALERTS_TOKEN
  });

  try {
    const point = Point.measurement('command')
      .setTag('node', node)
      .setIntegerField('factory_reset_code', FACTORY_RESET_CODE)
      .setTimestamp(new Date());

    await client.write([point], INFLUX_ALERTS_DB);

    return json({ ok: true, node });
  } catch (error) {
    console.error('resetCup write error:', error);
    return json({ error: 'Failed to write reset command' }, { status: 500 });
  } finally {
    await client.close();
  }
}
