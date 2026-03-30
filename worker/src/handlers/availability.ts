import { Env } from '../types';
import { redisGet, redisSet } from '../redis';
import { fetchStationAvailability, StationInput, ConnectorAvailability } from '../tomtom';
import { insertAvailabilityReading, getRecentHistory, ensureStationsExist, HistoryPoint } from '../supabase';

// Matches TomTom's own refresh cadence — no benefit polling more frequently
const AVAILABILITY_TTL = 180; // 3 minutes

// Max simultaneous TomTom calls per batch. Keep low to avoid 429s — each
// station costs up to 2 TomTom calls (nearbySearch + chargingAvailability)
// on first lookup, 1 call on subsequent polls (ID cached in Supabase).
const CONCURRENCY = 3;

// Pause between batches to stay within TomTom's rate limit (~5 req/s).
const BATCH_DELAY_MS = 150;

// Only fetch availability for the first N stations. They are already ordered
// by distance along the route so this prioritises the stations the driver
// will actually reach first.
const MAX_STATIONS = 20;

export interface StationAvailabilityResult {
  connectors: ConnectorAvailability[] | null;
  history: HistoryPoint[];
  fetchedAt: string;
}

type StationResult = { id: string; connectors: ConnectorAvailability[] | null; fromCache: boolean };

async function fetchOne(env: Env, station: StationInput): Promise<StationResult> {
  const cacheKey = `availability:${station.id}`;
  const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;

  const cached = await redisGet(env, cacheKey);
  if (cached) {
    const connectors = JSON.parse(cached) as ConnectorAvailability[];
    // Save the cached reading to Supabase on every poll so history accumulates
    // at the poll interval (60s) rather than only when the 3-min Redis cache expires.
    if (connectors.length > 0) {
      const ccs2 = connectors[0];
      ctx.waitUntil(insertAvailabilityReading(env, station.id, ccs2.available, ccs2.total).catch(() => {}));
    }
    return { id: station.id, connectors, fromCache: true };
  }

  const connectors = await fetchStationAvailability(env, station);

  if (connectors && connectors.length > 0) {
    // ctx.waitUntil ensures the Redis + Supabase writes complete even after the response
    // is sent — without this the Worker runtime kills dangling promises immediately.
    const ccs2 = connectors[0]; // We only track CCS2 (filtered in tomtom.ts)
    ctx.waitUntil(
      Promise.all([
        redisSet(env, cacheKey, JSON.stringify(connectors), AVAILABILITY_TTL).catch(() => {}),
        insertAvailabilityReading(env, station.id, ccs2.available, ccs2.total).catch(() => {}),
      ]),
    );
  }

  return { id: station.id, connectors: connectors ?? null, fromCache: false };
}

export async function handleAvailability(req: Request, env: Env): Promise<Response> {
  let stations: StationInput[];
  try {
    stations = await req.json() as StationInput[];
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!Array.isArray(stations) || stations.length === 0) {
    return new Response('Expected a non-empty array of stations', { status: 400 });
  }

  // Cap to the first MAX_STATIONS — they are ordered by distance along route
  // so this always covers the stations the driver will encounter first.
  const capped = stations.slice(0, MAX_STATIONS);

  // Ensure minimal station rows exist before inserting availability readings.
  // The corridor handler upserts full station data via ctx.waitUntil (background),
  // so it may not have committed yet when the first availability poll fires.
  // ensureStationsExist uses ignore-duplicates so it won't overwrite full rows.
  await ensureStationsExist(env, capped.map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))).catch(() => {});

  // Process in small batches with a pause between each to stay within
  // TomTom's rate limit (~5 req/s). Each station costs up to 2 TomTom calls.
  const allResults: PromiseSettledResult<StationResult>[] = [];
  for (let i = 0; i < capped.length; i += CONCURRENCY) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    const chunk = capped.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(chunk.map(s => fetchOne(env, s)));
    allResults.push(...chunkResults);
  }

  // Collect fulfilled results and station IDs that need history
  const fulfilled: StationResult[] = [];
  for (const result of allResults) {
    if (result.status === 'fulfilled') fulfilled.push(result.value);
  }

  const stationIds = fulfilled.map(r => r.id);
  const historyMap = await getRecentHistory(env, stationIds, 25).catch(() => new Map<string, HistoryPoint[]>());

  // Build response map: { [ocmId]: { connectors, history, fetchedAt } }
  // fetchedAt is the Worker server's current timestamp — same UTC source as
  // Supabase. The client uses this to render an immediate "current bar" without
  // mixing in the browser's clock (which may lag or skew vs. server time).
  const now = new Date().toISOString();
  const output: Record<string, StationAvailabilityResult> = {};
  for (const result of fulfilled) {
    const history = historyMap.get(result.id) ?? [];
    output[result.id] = { connectors: result.connectors, history, fetchedAt: now };
  }

  return new Response(JSON.stringify(output), {
    headers: { 'Content-Type': 'application/json' },
  });
}
