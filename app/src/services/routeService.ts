import type { LatLng, Route } from '../types/route';

const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

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

// "lat,lng" strings (from GPS recalculation) must be sent as latLng objects,
// not as address strings — the Routes API rejects them with 400 otherwise.
function parseLatLng(value: string): { latitude: number; longitude: number } | null {
  const parts = value.split(',');
  if (parts.length !== 2) return null;
  const latitude = parseFloat(parts[0]);
  const longitude = parseFloat(parts[1]);
  if (isNaN(latitude) || isNaN(longitude)) return null;
  return { latitude, longitude };
}

function toWaypoint(value: string): Record<string, unknown> {
  const latLng = parseLatLng(value);
  if (latLng) return { location: { latLng } };
  return { address: value };
}

export async function computeRoute(
  origin: string,
  destination: string,
  apiKey: string,
): Promise<Route> {
  const response = await fetch(ROUTES_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      polylineQuality: 'HIGH_QUALITY',
      polylineEncoding: 'ENCODED_POLYLINE',
    }),
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
