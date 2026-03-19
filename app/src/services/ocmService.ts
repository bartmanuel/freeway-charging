import type { Station } from '../types/station';

const BASE_URL = 'https://api.openchargemap.io/v3/poi/';

interface OCMConnection {
  PowerKW?: number | null;
  ConnectionType?: { Title?: string };
}

interface OCMStation {
  ID: number;
  AddressInfo?: {
    Title?: string;
    Latitude?: number;
    Longitude?: number;
    AddressLine1?: string;
    Country?: { ISOCode?: string };
  };
  OperatorInfo?: { Title?: string } | null;
  NumberOfPoints?: number | null;
  Connections?: OCMConnection[];
}

// OCM occasionally returns map-tile or placeholder names instead of real station names.
const INVALID_NAMES = new Set(['terrain', 'labels', 'satellite', 'roadmap', 'hybrid']);

function mapOCMStation(raw: OCMStation): Station | null {
  const addr = raw.AddressInfo;
  if (!addr?.Latitude || !addr?.Longitude) return null;

  const name = (addr.Title ?? '').trim();
  if (name.length < 3 || INVALID_NAMES.has(name.toLowerCase())) return null;

  const connections = (raw.Connections ?? []).map((c) => ({
    type: c.ConnectionType?.Title ?? 'Unknown',
    powerKw: c.PowerKW ?? null,
  }));

  const maxPowerKw = Math.max(
    0,
    ...connections.map((c) => c.powerKw ?? 0).filter((kw) => kw < 500), // cap bad data
  );

  return {
    id: raw.ID,
    name: addr.Title ?? 'Unknown',
    operator: raw.OperatorInfo?.Title ?? null,
    lat: addr.Latitude,
    lng: addr.Longitude,
    maxPowerKw,
    totalStalls: raw.NumberOfPoints ?? null,
    connectors: connections,
    address: addr.AddressLine1 ?? '',
    country: addr.Country?.ISOCode ?? '',
  };
}

// Max points to send in the OCM polyline query.
// Google Routes returns 300–600 points for long routes; URL-encoding that many
// pushes the URL over server limits (414). 100 points ≈ 1 pt/2 km for a 200 km
// route — more than sufficient to define a 3 km corridor accurately.
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

// Fetches stations along a route using OCM's polyline corridor search.
// Falls back to multiple radius queries if the polyline request fails or returns nothing.
export async function fetchStationsAlongRoute(
  decodedPath: { lat: number; lng: number }[],
  apiKey: string,
  bufferKm = 3,
): Promise<Station[]> {
  const params = new URLSearchParams({
    levelid: '3',
    minpowerkilowatts: '50',
    maxresults: '500',
    compact: 'false',
    verbose: 'false',
    key: apiKey,
  });

  // Strategy A: polyline corridor query
  try {
    const polyline = encodePolyline(subsamplePath(decodedPath, MAX_POLYLINE_POINTS));
    const url = `${BASE_URL}?${params}&polyline=${encodeURIComponent(polyline)}&distance=${bufferKm}&distanceunit=KM`;
    const res = await fetch(url);
    if (res.ok) {
      const data: OCMStation[] = await res.json();
      if (data.length > 0) {
        return data.map(mapOCMStation).filter((s): s is Station => s !== null);
      }
    }
  } catch {
    // fall through to Strategy B
  }

  // Strategy B: radius queries at intervals along the route
  // Subsample to one point roughly every 20 km
  const totalPoints = decodedPath.length;
  const step = Math.max(1, Math.floor(totalPoints / 7));
  const waypoints = decodedPath.filter((_, i) => i % step === 0 || i === totalPoints - 1);

  const seen = new Set<number>();
  const allStations: Station[] = [];

  for (const point of waypoints) {
    await new Promise((r) => setTimeout(r, 200)); // rate limit courtesy
    try {
      const url = `${BASE_URL}?${params}&latitude=${point.lat}&longitude=${point.lng}&distance=15&distanceunit=KM`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data: OCMStation[] = await res.json();
      for (const raw of data) {
        if (seen.has(raw.ID)) continue;
        seen.add(raw.ID);
        const station = mapOCMStation(raw);
        if (station) allStations.push(station);
      }
    } catch {
      continue;
    }
  }

  return allStations;
}
