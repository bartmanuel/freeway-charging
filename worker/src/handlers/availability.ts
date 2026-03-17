import { Env } from '../types';
import { redisGet, redisSet } from '../redis';
import { fetchStationAvailability } from '../chargetrip';
import { insertAvailabilityReadings } from '../supabase';

const AVAILABILITY_TTL = 30; // seconds

export async function handleAvailability(
  _req: Request,
  env: Env,
  stationId: string,
): Promise<Response> {
  if (!stationId) return new Response('Missing station id', { status: 400 });

  const key = `availability:${stationId}`;
  const cached = await redisGet(env, key);
  if (cached) {
    return new Response(cached, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    });
  }

  const chargers = await fetchStationAvailability(env, stationId);
  if (!chargers) {
    return new Response(JSON.stringify({ stationId, chargers: null }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = {
    stationId,
    sampledAt: new Date().toISOString(),
    source: 'chargetrip',
    chargers,
  };

  const payload = JSON.stringify(result);
  await Promise.all([
    redisSet(env, key, payload, AVAILABILITY_TTL),
    insertAvailabilityReadings(env, [
      { station_id: stationId, source: 'chargetrip', chargers },
    ]),
  ]);

  return new Response(payload, {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  });
}
