import { Env, Station } from '../types';
import { getStationsInBbox, upsertStations } from '../supabase';
import { fetchStationsFromOCM } from '../ocm';

/**
 * Deduplicate stations by proximity. When two stations are within
 * `thresholdM` metres of each other, keep only the one with the preferred
 * source (NDW > everything else). This prevents the same physical charger
 * appearing twice when both an NDW row and an old OCM row exist in Supabase.
 */
function dedupeByProximity(stations: Station[], thresholdM = 100): Station[] {
  // Sort so NDW stations come first — they win ties.
  const sorted = [...stations].sort((a, b) => {
    const aIsNdw = a.id.startsWith('ndw:') ? 0 : 1;
    const bIsNdw = b.id.startsWith('ndw:') ? 0 : 1;
    return aIsNdw - bIsNdw;
  });

  const kept: Station[] = [];
  for (const candidate of sorted) {
    const isDupe = kept.some(k => {
      const dLat = (k.lat - candidate.lat) * 111_000;
      const dLng = (k.lng - candidate.lng) * 111_000 * Math.cos((k.lat * Math.PI) / 180);
      return Math.sqrt(dLat * dLat + dLng * dLng) < thresholdM;
    });
    if (!isDupe) kept.push(candidate);
  }
  return kept;
}

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
    const deduped = dedupeByProximity(stored);
    return new Response(JSON.stringify(deduped), {
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

  // 4. Merge — Supabase partial results + OCM results, deduped by ID then by proximity
  const storedIds = new Set(stored.map(s => s.id));
  const merged = dedupeByProximity([...stored, ...ocmStations.filter(s => !storedIds.has(s.id))]);

  return new Response(JSON.stringify(merged), {
    headers: { 'Content-Type': 'application/json', 'X-Source': 'ocm' },
  });
}
