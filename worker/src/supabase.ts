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
  minPowerKw = 150,
): Promise<Station[]> {
  // PostgREST: multiple params for the same column are ANDed together
  const params = new URLSearchParams([
    ['select', 'id,name,operator,lat,lng,max_power_kw,total_stalls,connectors,address,country'],
    ['lat', `gte.${minLat}`],
    ['lat', `lte.${maxLat}`],
    ['lng', `gte.${minLng}`],
    ['lng', `lte.${maxLng}`],
    ['max_power_kw', `gte.${minPowerKw}`],
  ]);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stations?${params}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`Supabase stations query failed: ${res.status}`);
  return res.json() as Promise<Station[]>;
}

/** Upsert a batch of stations (merge on id). Duplicates within the batch are deduped first. */
export async function upsertStations(env: Env, stations: Station[]): Promise<void> {
  if (!stations.length) return;

  // Dedupe by id — OCM can return the same station across multiple pages
  const seen = new Set<string>();
  const unique = stations.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });

  // Upsert in batches of 200 to stay within Supabase request size limits
  const BATCH = 200;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stations`, {
      method: 'POST',
      headers: { ...headers(env), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase upsert failed (${res.status}): ${err}`);
    }
  }
}

