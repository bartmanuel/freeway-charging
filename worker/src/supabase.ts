import { Env, Station } from './types';

function headers(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Fetch stations within a bounding box from Supabase. */
export async function getStationsInBbox(
  env: Env,
  minLat: number,
  maxLat: number,
  minLng: number,
  maxLng: number,
): Promise<Station[]> {
  const params = new URLSearchParams({
    select: 'id,name,operator,lat,lng,max_power_kw,total_stalls,connectors,address,country',
    lat: `gte.${minLat}`,
    and: `(lat.lte.${maxLat},lng.gte.${minLng},lng.lte.${maxLng})`,
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stations?${params}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`Supabase stations query failed: ${res.status}`);
  return res.json() as Promise<Station[]>;
}

/** Write a batch of availability readings. */
export async function insertAvailabilityReadings(
  env: Env,
  rows: { station_id: string; source: string; chargers: unknown }[],
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/station_availability`, {
    method: 'POST',
    headers: { ...headers(env), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase insert availability failed: ${res.status}`);
}
