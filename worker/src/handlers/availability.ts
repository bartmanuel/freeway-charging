import { Env } from '../types';
import { redisGet, redisSet } from '../redis';
import { fetchStationAvailability, StationInput, ConnectorAvailability } from '../tomtom';

// Matches TomTom's own refresh cadence — no benefit polling more frequently
const AVAILABILITY_TTL = 180; // 3 minutes

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

  // Fetch availability for all stations in parallel
  const results = await Promise.allSettled(
    stations.map(async (station) => {
      const cacheKey = `availability:${station.id}`;

      // Redis cache hit — return early
      const cached = await redisGet(env, cacheKey);
      if (cached) {
        return { id: station.id, connectors: JSON.parse(cached) as ConnectorAvailability[], fromCache: true };
      }

      const connectors = await fetchStationAvailability(env, station);

      if (connectors && connectors.length > 0) {
        // Cache in background — don't block the response
        redisSet(env, cacheKey, JSON.stringify(connectors), AVAILABILITY_TTL).catch(() => {/* best-effort */});
      }

      return { id: station.id, connectors: connectors ?? null };
    }),
  );

  // Build response map: { [ocmId]: ConnectorAvailability[] | null }
  const output: Record<string, ConnectorAvailability[] | null> = {};
  for (const result of results) {
    if (result.status === 'fulfilled') {
      output[result.value.id] = result.value.connectors;
    }
    // Rejected promises are silently omitted — station simply won't appear in response
  }

  return new Response(JSON.stringify(output), {
    headers: { 'Content-Type': 'application/json' },
  });
}
