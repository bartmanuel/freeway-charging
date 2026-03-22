import { Env } from '../types';
import { getStationsInBbox, upsertStations } from '../supabase';
import { fetchStationsFromOCM } from '../ocm';

// Minimum stations in Supabase before we consider the data sufficient.
// Below this threshold we fall back to OCM as a supplemental source.
// With a fully-populated NDW dataset this threshold is easily met for
// any Dutch route; OCM is mainly needed for cross-border or uncharted areas.
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

  const { minLat, maxLat, minLng, maxLng, minPowerKw = 50, encodedPolyline } = body;
  if (minLat == null || maxLat == null || minLng == null || maxLng == null) {
    return new Response('minLat, maxLat, minLng, maxLng are required', { status: 400 });
  }

  const bbox = { minLat, maxLat, minLng, maxLng };

  // 1. Supabase first — NDW bulk data + any previously OCM-fetched stations
  const stored = await getStationsInBbox(env, minLat, maxLat, minLng, maxLng, minPowerKw);

  if (stored.length >= MIN_CACHE_HIT) {
    // Supabase has sufficient data — return it directly.
    // No background OCM refresh: Supabase is updated by the periodic NDW
    // ingestion job (scripts/ingest-ndw.py), not by on-demand OCM calls.
    return new Response(JSON.stringify(stored), {
      headers: { 'Content-Type': 'application/json', 'X-Source': 'supabase' },
    });
  }

  // 2. Supabase sparse or empty — fall back to OCM for uncharted areas
  //    (cross-border routes, countries not yet ingested into Supabase)
  const ocmStations = await fetchStationsFromOCM(env, bbox, encodedPolyline);

  // 3. Upsert OCM results into Supabase in the background
  if (ocmStations.length > 0) {
    const ctx = (globalThis as unknown as { ctx?: ExecutionContext }).ctx;
    const upsert = upsertStations(env, ocmStations);
    if (ctx) {
      ctx.waitUntil(upsert);
    } else {
      upsert.catch(err => console.error('Background upsert failed:', err));
    }
  }

  // 4. Merge — Supabase partial results + OCM results, deduped
  const storedIds = new Set(stored.map(s => s.id));
  const merged = [...stored, ...ocmStations.filter(s => !storedIds.has(s.id))];

  return new Response(JSON.stringify(merged), {
    headers: { 'Content-Type': 'application/json', 'X-Source': 'ocm' },
  });
}
