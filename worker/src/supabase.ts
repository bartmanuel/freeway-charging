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
  // PostgREST: multiple params for the same column are ANDed together.
  // Order by max_power_kw DESC so that if the result set exceeds the row
  // limit the highest-power stations (IONITY, Fastned, Tesla) are returned
  // first. Limit set high enough to cover any realistic route bbox.
  const params = new URLSearchParams([
    ['select', 'id,name,operator,lat,lng,max_power_kw,total_stalls,connectors,address,country'],
    ['lat', `gte.${minLat}`],
    ['lat', `lte.${maxLat}`],
    ['lng', `gte.${minLng}`],
    ['lng', `lte.${maxLng}`],
    ['max_power_kw', `gte.${minPowerKw}`],
    ['order', 'max_power_kw.desc'],
    ['limit', '10000'],
  ]);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stations?${params}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`Supabase stations query failed: ${res.status}`);
  return res.json() as Promise<Station[]>;
}

export interface HistoryPoint {
  ts: string;    // ISO timestamp (sampled_at)
  avail: number;
  total: number;
}

/**
 * Insert a single CCS2 availability reading for a station.
 * Silently swallows FK violations (station not yet in stations table on first poll).
 */
export async function insertAvailabilityReading(
  env: Env,
  stationId: string,
  avail: number,
  total: number,
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/station_availability`, {
    method: 'POST',
    headers: { ...headers(env), Prefer: 'return=minimal' },
    body: JSON.stringify({ station_id: stationId, source: 'tomtom', chargers: { avail, total } }),
  });
  if (!res.ok) {
    const err = await res.text();
    // 23503 = FK violation (station not yet persisted) — safe to ignore
    if (!err.includes('23503')) throw new Error(`Supabase availability insert failed (${res.status}): ${err}`);
  }
}

/**
 * Fetch the most recent `perStation` readings for each of the given station IDs.
 * Returns a map keyed by station ID, values ordered newest-first.
 */
export async function getRecentHistory(
  env: Env,
  stationIds: string[],
  perStation = 12,
): Promise<Map<string, HistoryPoint[]>> {
  if (!stationIds.length) return new Map();

  const params = new URLSearchParams([
    ['select', 'station_id,sampled_at,chargers'],
    ['station_id', `in.(${stationIds.join(',')})`],
    ['order', 'sampled_at.desc'],
    ['limit', String(perStation * stationIds.length)],
  ]);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/station_availability?${params}`, {
    headers: headers(env),
  });
  if (!res.ok) throw new Error(`Supabase history query failed: ${res.status}`);

  const rows = await res.json() as { station_id: string; sampled_at: string; chargers: { avail: number; total: number } }[];

  const out = new Map<string, HistoryPoint[]>();
  for (const row of rows) {
    const pts = out.get(row.station_id) ?? [];
    if (pts.length < perStation) {
      pts.push({ ts: row.sampled_at, avail: row.chargers.avail, total: row.chargers.total });
      out.set(row.station_id, pts);
    }
  }
  return out;
}

/**
 * Ensure a set of minimal station rows exist in the stations table so that
 * subsequent availability inserts don't hit a FK violation.  Uses
 * `ignore-duplicates` so fully-populated rows written by the corridor handler
 * are never overwritten.
 */
export async function ensureStationsExist(
  env: Env,
  stations: { id: string; name: string; lat: number; lng: number }[],
): Promise<void> {
  if (!stations.length) return;
  const seen = new Set<string>();
  const unique = stations.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  const BATCH = 200;
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH).map(s => ({
      id: s.id, name: s.name, lat: s.lat, lng: s.lng,
      max_power_kw: 0, connectors: [], address: null, country: null, operator: null, total_stalls: null,
    }));
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/stations`, {
      method: 'POST',
      headers: { ...headers(env), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase ensureStationsExist failed (${res.status}): ${err}`);
    }
  }
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

