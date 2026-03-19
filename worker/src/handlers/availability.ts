import { Env } from '../types';
import { redisGet, redisSet } from '../redis';
import { fetchStationAvailability, StationInput, ConnectorAvailability } from '../tomtom';

// Matches TomTom's own refresh cadence — no benefit polling more frequently
const AVAILABILITY_TTL = 180; // 3 minutes

// Max simultaneous TomTom nearbySearch calls. Batching prevents rate-limit
// 429s that occur when 15+ calls fire at once (Worker → TomTom is not
// throttled by a browser's per-domain connection limit like the old client path).
const CONCURRENCY = 5;

type StationResult = { id: string; connectors: ConnectorAvailability[] | null };

async function fetchOne(env: Env, station: StationInput): Promise<StationResult> {
  const cacheKey = `availability:${station.id}`;
  const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;

  const cached = await redisGet(env, cacheKey);
  if (cached) {
    return { id: station.id, connectors: JSON.parse(cached) as ConnectorAvailability[] };
  }

  const connectors = await fetchStationAvailability(env, station);

  if (connectors && connectors.length > 0) {
    // ctx.waitUntil ensures the Redis write completes even after the response
    // is sent — without this the Worker runtime kills dangling promises immediately.
    ctx.waitUntil(
      redisSet(env, cacheKey, JSON.stringify(connectors), AVAILABILITY_TTL).catch(() => {}),
    );
  }

  return { id: station.id, connectors: connectors ?? null };
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

  // Build response map: { [ocmId]: ConnectorAvailability[] | null }
  const output: Record<string, ConnectorAvailability[] | null> = {};
  for (const result of allResults) {
    if (result.status === 'fulfilled') {
      output[result.value.id] = result.value.connectors;
    }
    // Rejected promises are silently omitted — station simply won't appear in response
  }

  return new Response(JSON.stringify(output), {
    headers: { 'Content-Type': 'application/json' },
  });
}
