import { Env } from '../types';
import { redisGet, redisSet } from '../redis';

const AMENITY_TTL = 86_400; // 24 hours — motorway services don't move

// Brands we care about — regex that matches any of them (case-insensitive)
const BRAND_PATTERN =
  'Starbucks|McDonald|Burger King|\\bKFC\\b|Kentucky Fried|Autogrill|\\bPAUL\\b|Bonjour|Serways|Sanifair|2theLoo|2thloo|Carrefour|Arche|Shell';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassNode[];
}

export interface AmenityItem {
  brand: string;
  name: string;
  distance: number;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normaliseBrand(name: string): string | null {
  const s = name.toLowerCase();
  if (s.includes('starbucks')) return 'starbucks';
  if (s.includes('mcdonald') || s.includes('mc donald')) return 'mcdonalds';
  if (s.includes('burger king')) return 'burger_king';
  if (/\bkfc\b/.test(s) || s.includes('kentucky fried')) return 'kfc';
  if (s.includes('autogrill')) return 'autogrill';
  if (/\bpaul\b/.test(s)) return 'paul';
  if (s.includes('bonjour')) return 'bonjour';
  if (s.includes('serways')) return 'serways';
  if (s.includes('sanifair')) return 'sanifair';
  if (s.includes('2theloo') || s.includes('2thloo')) return '2theloo';
  if (s.includes('carrefour')) return 'carrefour';
  if (s.includes('arche')) return 'larche';
  if (s.includes('shell')) return 'shell';
  return null;
}

async function fetchAmenitiesFromOverpass(lat: number, lng: number): Promise<AmenityItem[]> {
  const query = `[out:json][timeout:10];
(
  node[~"^(name|brand|operator)$"~"${BRAND_PATTERN}",i](around:600,${lat},${lng});
  way[~"^(name|brand|operator)$"~"${BRAND_PATTERN}",i](around:600,${lat},${lng});
);
out center;`;

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) return [];

  const data = await res.json() as OverpassResponse;
  const seen = new Set<string>();
  const results: AmenityItem[] = [];

  for (const el of data.elements) {
    const elLat = el.lat ?? (el as unknown as { center?: { lat: number } }).center?.lat;
    const elLon = el.lon ?? (el as unknown as { center?: { lon: number } }).center?.lon;
    if (elLat == null || elLon == null) continue;

    const name =
      el.tags?.name ?? el.tags?.brand ?? el.tags?.operator ?? '';
    if (!name) continue;

    const brand = normaliseBrand(name);
    if (!brand) continue;

    // De-duplicate by brand within this station
    if (seen.has(brand)) continue;
    seen.add(brand);

    const distance = Math.round(haversineMeters(lat, lng, elLat, elLon));
    results.push({ brand, name, distance });
  }

  return results.sort((a, b) => a.distance - b.distance);
}

interface StationInput {
  id: string;
  lat: number;
  lng: number;
}

export async function handleAmenities(req: Request, env: Env): Promise<Response> {
  let stations: StationInput[];
  try {
    stations = await req.json() as StationInput[];
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!Array.isArray(stations) || stations.length === 0) {
    return new Response('Expected a non-empty array', { status: 400 });
  }

  const output: Record<string, AmenityItem[]> = {};

  await Promise.allSettled(
    stations.map(async station => {
      const cacheKey = `amenities:${station.id}`;
      const cached = await redisGet(env, cacheKey);
      if (cached) {
        output[station.id] = JSON.parse(cached) as AmenityItem[];
        return;
      }

      const amenities = await fetchAmenitiesFromOverpass(station.lat, station.lng);
      output[station.id] = amenities;

      // Cache even empty results so we don't hammer Overpass
      const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;
      ctx.waitUntil(
        redisSet(env, cacheKey, JSON.stringify(amenities), AMENITY_TTL).catch(() => {}),
      );
    }),
  );

  return new Response(JSON.stringify(output), {
    headers: { 'Content-Type': 'application/json' },
  });
}
