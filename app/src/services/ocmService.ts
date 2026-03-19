import type { Station } from '../types/station';

const WORKER_URL = 'https://freeway-charge-api.bartmanuel.workers.dev';

// Worker Station type uses snake_case (Supabase column names)
interface WorkerStation {
  id: string;
  name: string;
  operator: string | null;
  lat: number;
  lng: number;
  max_power_kw: number | null;
  total_stalls: number | null;
  connectors: { type: string; powerKw: number }[] | null;
  address: string | null;
  country: string | null;
}

function mapWorkerStation(s: WorkerStation): Station {
  return {
    id: Number(s.id),
    name: s.name,
    operator: s.operator,
    lat: s.lat,
    lng: s.lng,
    maxPowerKw: s.max_power_kw ?? 0,
    totalStalls: s.total_stalls,
    connectors: s.connectors ?? [],
    address: s.address ?? '',
    country: s.country ?? '',
  };
}

// Max points to send in the corridor polyline parameter.
const MAX_POLYLINE_POINTS = 100;

// Reduces a path to at most maxPoints by uniform subsampling, keeping first and last.
function subsamplePath(
  path: { lat: number; lng: number }[],
  maxPoints: number,
): { lat: number; lng: number }[] {
  if (path.length <= maxPoints) return path;
  const step = (path.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => path[Math.round(i * step)]);
}

// Encodes an array of LatLng points as a Google encoded polyline string.
function encodePolyline(points: { lat: number; lng: number }[]): string {
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const { lat, lng } of points) {
    const encodeValue = (value: number): string => {
      let v = value < 0 ? ~(value << 1) : value << 1;
      let chunk = '';
      while (v >= 0x20) {
        chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
        v >>= 5;
      }
      chunk += String.fromCharCode(v + 63);
      return chunk;
    };

    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    output += encodeValue(latE5 - prevLat) + encodeValue(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return output;
}

// Fetches stations along a route via the Worker's corridor endpoint.
// The Worker serves from its Supabase cache and falls back to OCM on cache miss.
// The apiKey parameter is kept for backward compatibility but is no longer used
// (the Worker holds its own OCM key server-side).
export async function fetchStationsAlongRoute(
  decodedPath: { lat: number; lng: number }[],
  _apiKey: string,
): Promise<Station[]> {
  const lats = decodedPath.map(p => p.lat);
  const lngs = decodedPath.map(p => p.lng);
  const bbox = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };

  const encodedPolyline = encodePolyline(subsamplePath(decodedPath, MAX_POLYLINE_POINTS));

  const res = await fetch(`${WORKER_URL}/api/stations/corridor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bbox, encodedPolyline }),
  });

  if (!res.ok) throw new Error(`Corridor endpoint error: ${res.status}`);

  const data = await res.json() as WorkerStation[];
  return data.map(mapWorkerStation);
}
