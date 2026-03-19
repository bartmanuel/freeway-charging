import type { LatLng } from '../types/route';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export interface RouteProjection {
  distanceAlongRouteMeters: number; // how far along the route the user is
  distanceFromRouteMeters: number;  // perpendicular distance from the polyline
}

/**
 * Projects a GPS point onto a route polyline.
 * Returns the user's position expressed as:
 *   - distanceAlongRouteMeters: progress along the route from origin
 *   - distanceFromRouteMeters: how far off the route they are
 */
export function projectOntoRoute(
  lat: number,
  lng: number,
  path: LatLng[],
): RouteProjection {
  if (path.length < 2) {
    return { distanceAlongRouteMeters: 0, distanceFromRouteMeters: 0 };
  }

  const p: LatLng = { lat, lng };
  let cumulativeKm = 0;
  let minDistKm = Infinity;
  let bestAlongKm = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLenKm = haversineKm(a, b);

    // Project p onto segment a→b using cosLat-normalised coordinates
    const cosLat = Math.cos(toRad((a.lat + b.lat) / 2));
    const ax = a.lng * cosLat, ay = a.lat;
    const bx = b.lng * cosLat, by = b.lat;
    const px = p.lng * cosLat, py = p.lat;

    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0
      ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
      : 0;

    const nearestLng = (ax + t * dx) / cosLat;
    const nearestLat = ay + t * dy;
    const distKm = haversineKm(p, { lat: nearestLat, lng: nearestLng });

    if (distKm < minDistKm) {
      minDistKm = distKm;
      bestAlongKm = cumulativeKm + t * segLenKm;
    }

    cumulativeKm += segLenKm;
  }

  return {
    distanceAlongRouteMeters: bestAlongKm * 1000,
    distanceFromRouteMeters: minDistKm * 1000,
  };
}
