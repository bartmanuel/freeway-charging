import { Env } from '../types';
import { redisGet, redisSet } from '../redis';

const ROUTE_TTL = 60 * 60 * 24 * 30; // 30 days — Google Maps ToS allows this

interface RouteRequest {
  origin: string;
  destination: string;
}

function cacheKey(origin: string, destination: string): string {
  return `route:${origin.toLowerCase()}:${destination.toLowerCase()}`;
}

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

export async function handleRoute(req: Request, env: Env): Promise<Response> {
  let body: RouteRequest;
  try {
    body = await req.json() as RouteRequest;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { origin, destination } = body;
  if (!origin || !destination) {
    return new Response('origin and destination are required', { status: 400 });
  }

  const key = cacheKey(origin, destination);
  const cached = await redisGet(env, key);
  if (cached) {
    return new Response(cached, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    });
  }

  const googleRes = await fetch(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode: 'DRIVE',
        polylineQuality: 'HIGH_QUALITY',
        polylineEncoding: 'ENCODED_POLYLINE',
      }),
    },
  );

  if (!googleRes.ok) {
    const err = await googleRes.text();
    return new Response(`Google Routes API error: ${err}`, { status: 502 });
  }

  const data = await googleRes.text();
  await redisSet(env, key, data, ROUTE_TTL);

  return new Response(data, {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  });
}
