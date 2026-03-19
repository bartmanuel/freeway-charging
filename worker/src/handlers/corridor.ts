import { Env } from '../types';
import { getStationsInBbox, upsertStations } from '../supabase';
import { fetchStationsFromOCM } from '../ocm';

// If Supabase returns fewer than this many stations for the bbox,
// treat the cache as cold and fall back to OCM.
const MIN_CACHE_HIT = 3;

interface CorridorRequest {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minPowerKw?: number;
  // Optional: encoded polyline for a tighter OCM corridor query on cache miss
  encodedPolyline?: string;
}

export async function handleCorridor(req: Request, env: Env): Promise<Response> {
  let body: CorridorRequest;
  try {
    body = await req.json() as CorridorRequest;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { minLat, maxLat, minLng, maxLng, minPowerKw = 150, encodedPolyline } = body;
  if (minLat == null || maxLat == null || minLng == null || maxLng == null) {
    return new Response('minLat, maxLat, minLng, maxLng are required', { status: 400 });
  }

  const bbox = { minLat, maxLat, minLng, maxLng };

  // 1. Try Supabase cache first
  const cached = await getStationsInBbox(env, minLat, maxLat, minLng, maxLng, minPowerKw);

  if (cached.length >= MIN_CACHE_HIT) {
    // Return cached result immediately, but refresh from OCM in the background
    // (stale-while-revalidate) so the next request sees up-to-date station data.
    const ctx = (globalThis as unknown as { ctx?: ExecutionContext }).ctx;
    const refresh = fetchStationsFromOCM(env, bbox, encodedPolyline)
      .then(stations => stations.length > 0 ? upsertStations(env, stations) : Promise.resolve())
      .catch(() => {}); // silent — OCM may be temporarily down
    if (ctx) ctx.waitUntil(refresh);

    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json', 'X-Source': 'cache' },
    });
  }

  // 2. Cache cold (or sparse) — fetch from OCM
  const ocmStations = await fetchStationsFromOCM(env, bbox, encodedPolyline);

  // 3. Upsert into Supabase in the background (don't await — don't block the response)
  if (ocmStations.length > 0) {
    const ctx = (globalThis as unknown as { ctx?: ExecutionContext }).ctx;
    const upsert = upsertStations(env, ocmStations);
    if (ctx) {
      ctx.waitUntil(upsert);
    } else {
      upsert.catch(err => console.error('Background upsert failed:', err));
    }
  }

  // 4. Merge with anything already in cache (avoids duplicates on the first partial hit)
  const cachedIds = new Set(cached.map(s => s.id));
  const merged = [...cached, ...ocmStations.filter(s => !cachedIds.has(s.id))];

  return new Response(JSON.stringify(merged), {
    headers: { 'Content-Type': 'application/json', 'X-Source': 'ocm' },
  });
}
