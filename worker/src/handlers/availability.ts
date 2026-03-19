import { Env } from '../types';
import { redisGet, redisSet } from '../redis';
import { fetchStationAvailability, StationInput, ConnectorAvailability } from '../tomtom';
import { insertAvailabilityReading, getRecentHistory, HistoryPoint } from '../supabase';

// Matches TomTom's own refresh cadence — no benefit polling more frequently
const AVAILABILITY_TTL = 180; // 3 minutes

// Max simultaneous TomTom nearbySearch calls. Batching prevents rate-limit
// 429s that occur when 15+ calls fire at once (Worker → TomTom is not
// throttled by a browser's per-domain connection limit like the old client path).
const CONCURRENCY = 5;

export interface StationAvailabilityResult {
  connectors: ConnectorAvailability[] | null;
  history: HistoryPoint[];
}

type StationResult = { id: string; connectors: ConnectorAvailability[] | null; fromCache: boolean };

async function fetchOne(env: Env, station: StationInput): Promise<StationResult> {
  const cacheKey = `availability:${station.id}`;
  const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;

  const cached = await redisGet(env, cacheKey);
  if (cached) {
    return { id: station.id, connectors: JSON.parse(cached) as ConnectorAvailability[], fromCache: true };
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

  // Process in batches of CONCURRENCY to avoid TomTom rate limits
  const allResults: PromiseSettledResult<StationResult>[] = [];
  for (let i = 0; i < stations.length; i += CONCURRENCY) {
    const chunk = stations.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.allSettled(chunk.map(s => fetchOne(env, s)));
    allResults.push(...chunkResults);
  }

  // Collect fulfilled results and station IDs that need history
  const fulfilled: StationResult[] = [];
  for (const result of allResults) {
    if (result.status === 'fulfilled') fulfilled.push(result.value);
  }

  const stationIds = fulfilled.map(r => r.id);
  const historyMap = await getRecentHistory(env, stationIds).catch(() => new Map<string, HistoryPoint[]>());

  // Build response map: { [ocmId]: { connectors, history } }
  const output: Record<string, StationAvailabilityResult> = {};
  for (const result of fulfilled) {
    output[result.id] = {
      connectors: result.connectors,
      history: historyMap.get(result.id) ?? [],
    };
  }

  return new Response(JSON.stringify(output), {
    headers: { 'Content-Type': 'application/json' },
  });
}
