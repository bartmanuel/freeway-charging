import { Env, Station } from '../types';
import { getStationsInBbox } from '../supabase';

interface CorridorRequest {
  // Bounding box of the route polyline (client computes this)
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minPowerKw?: number;
}

export async function handleCorridor(req: Request, env: Env): Promise<Response> {
  let body: CorridorRequest;
  try {
    body = await req.json() as CorridorRequest;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { minLat, maxLat, minLng, maxLng, minPowerKw = 150 } = body;
  if (minLat == null || maxLat == null || minLng == null || maxLng == null) {
    return new Response('minLat, maxLat, minLng, maxLng are required', { status: 400 });
  }

  const stations = await getStationsInBbox(env, minLat, maxLat, minLng, maxLng);
  const filtered = stations.filter(
    (s: Station) => s.max_power_kw == null || s.max_power_kw >= minPowerKw,
  );

  return new Response(JSON.stringify(filtered), {
    headers: { 'Content-Type': 'application/json' },
  });
}
