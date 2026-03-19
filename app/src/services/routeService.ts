import type { LatLng, Route } from '../types/route';

const WORKER_URL = 'https://freeway-charge-api.bartmanuel.workers.dev';

// Decodes a Google encoded polyline string into an array of LatLng points.
export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

export async function computeRoute(origin: string, destination: string): Promise<Route> {
  const response = await fetch(`${WORKER_URL}/api/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin, destination }),
  });

  if (!response.ok) {
    throw new Error(`Routes API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('No route returned from Routes API');

  const encodedPolyline = route.polyline.encodedPolyline as string;

  return {
    id: crypto.randomUUID(),
    origin,
    destination,
    encodedPolyline,
    decodedPath: decodePolyline(encodedPolyline),
    distanceMeters: route.distanceMeters as number,
    durationSeconds: parseInt((route.duration as string).replace('s', ''), 10),
  };
}
