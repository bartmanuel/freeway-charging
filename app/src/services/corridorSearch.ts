import RBush from 'rbush';
import type { LatLng } from '../types/route';
import type { Station, StationOnRoute } from '../types/station';

const CORRIDOR_BUFFER_KM = 3;
const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Haversine distance between two points in km.
function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Shortest distance from point P to segment AB (in km), plus the projection parameter t ∈ [0,1].
// Also returns the signed cross product to determine which side of the segment the point is on.
// cross < 0 → point is to the RIGHT of travel direction (accessible in right-hand traffic).
// cross > 0 → point is to the LEFT (opposite side, behind barriers).
function pointToSegmentDistance(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): { distanceKm: number; t: number; cross: number } {
  // Normalise longitude for latitude distortion so the cross product is geometrically meaningful.
  const cosLat = Math.cos(toRad((a.lat + b.lat) / 2));

  const ax = a.lng * cosLat;
  const ay = a.lat;
  const bx = b.lng * cosLat;
  const by = b.lat;
  const px = p.lng * cosLat;
  const py = p.lat;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  }

  const nearestLng = (ax + t * dx) / cosLat;
  const nearestLat = ay + t * dy;
  const distanceKm = haversineKm(p, { lat: nearestLat, lng: nearestLng });

  // 2D cross product of direction vector × station-offset vector.
  const sx = px - (ax + t * dx);
  const sy = py - (ay + t * dy);
  const cross = dx * sy - dy * sx;

  return { distanceKm, t, cross };
}

// Stations within this distance of the polyline are treated as centre-line
// (e.g. island service areas accessible from both directions) — include regardless of side.
// Most highway service areas sit 80-200m from the road centreline on one side only.
// True island Raststätten (serving both directions) are rare and sit within ~20m of centre.
const CENTRE_TOLERANCE_KM = 0.02;

// Number of segments either side of the nearest segment to average for the direction vector.
// Smoothing over a window avoids misclassification at highway kinks and interchanges.
const DIRECTION_SMOOTHING_WINDOW = 8;

// Returns the smoothed direction vector (cosLat-normalised) around segment index i.
function smoothedDirection(
  path: LatLng[],
  segmentIndex: number,
): { dx: number; dy: number } {
  const start = Math.max(0, segmentIndex - DIRECTION_SMOOTHING_WINDOW);
  const end = Math.min(path.length - 1, segmentIndex + DIRECTION_SMOOTHING_WINDOW + 1);
  const a = path[start];
  const b = path[end];
  const cosLat = Math.cos(toRad((a.lat + b.lat) / 2));
  return {
    dx: (b.lng - a.lng) * cosLat,
    dy: b.lat - a.lat,
  };
}

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  station: Station;
}

// Cumulative distances along the route polyline in km (index i = distance from start to point i).
function buildCumulativeDistances(path: LatLng[]): number[] {
  const distances = [0];
  for (let i = 1; i < path.length; i++) {
    distances.push(distances[i - 1] + haversineKm(path[i - 1], path[i]));
  }
  return distances;
}

export function findStationsAlongRoute(
  path: LatLng[],
  stations: Station[],
  bufferKm: number = CORRIDOR_BUFFER_KM,
): StationOnRoute[] {
  if (path.length < 2 || stations.length === 0) return [];

  // Build R-tree for fast spatial lookups.
  const tree = new RBush<RBushItem>();
  const bufferDeg = bufferKm / 111; // rough degree equivalent of buffer
  tree.load(
    stations.map((station) => ({
      minX: station.lng - bufferDeg,
      minY: station.lat - bufferDeg,
      maxX: station.lng + bufferDeg,
      maxY: station.lat + bufferDeg,
      station,
    })),
  );

  const cumulativeDistances = buildCumulativeDistances(path);
  const totalRouteKm = cumulativeDistances[cumulativeDistances.length - 1];

  // Build bounding box of the full route for initial R-tree query.
  const routeBbox = path.reduce(
    (bbox, p) => ({
      minX: Math.min(bbox.minX, p.lng),
      minY: Math.min(bbox.minY, p.lat),
      maxX: Math.max(bbox.maxX, p.lng),
      maxY: Math.max(bbox.maxY, p.lat),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  const candidates = tree.search({
    minX: routeBbox.minX - bufferDeg,
    minY: routeBbox.minY - bufferDeg,
    maxX: routeBbox.maxX + bufferDeg,
    maxY: routeBbox.maxY + bufferDeg,
  });

  const results: StationOnRoute[] = [];

  for (const { station } of candidates) {
    const stationPoint: LatLng = { lat: station.lat, lng: station.lng };
    let minDistKm = Infinity;
    let bestSegmentIndex = 0;
    let bestT = 0;
    // Find the closest point on the polyline.
    for (let i = 0; i < path.length - 1; i++) {
      const { distanceKm, t } = pointToSegmentDistance(stationPoint, path[i], path[i + 1]);
      if (distanceKm < minDistKm) {
        minDistKm = distanceKm;
        bestSegmentIndex = i;
        bestT = t;
      }
    }

    if (minDistKm > bufferKm) continue;

    // Directional filter: only include stations on the RIGHT side of the travel direction.
    // Use a smoothed direction vector over ±DIRECTION_SMOOTHING_WINDOW segments to avoid
    // misclassification at kinks and interchanges where the nearest segment may briefly
    // point in the wrong direction.
    // cross < 0 → right side (accessible in right-hand traffic countries like NL/DE).
    // Stations within CENTRE_TOLERANCE_KM (island service areas) are always included.
    if (minDistKm > CENTRE_TOLERANCE_KM) {
      const nearest = path[bestSegmentIndex];
      const { dx: sdx, dy: sdy } = smoothedDirection(path, bestSegmentIndex);
      const cosLat = Math.cos(toRad(nearest.lat));
      const sx = (stationPoint.lng - nearest.lng) * cosLat;
      const sy = stationPoint.lat - nearest.lat;
      const smoothedCross = sdx * sy - sdy * sx;
      if (smoothedCross > 0) continue;
    }

    // Distance along route = cumulative distance to segment start + fraction of segment length.
    const segmentLength = haversineKm(path[bestSegmentIndex], path[bestSegmentIndex + 1]);
    const distanceAlongRouteKm =
      cumulativeDistances[bestSegmentIndex] + bestT * segmentLength;

    results.push({
      station,
      distanceAlongRouteMeters: distanceAlongRouteKm * 1000,
      detourMeters: minDistKm * 1000,
      score: scoreStation(station, minDistKm, distanceAlongRouteKm, totalRouteKm),
    });
  }

  // Sort by position along the route.
  return results.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
}

function scoreStation(
  station: Station,
  detourKm: number,
  distanceAlongRouteKm: number,
  totalRouteKm: number,
): number {
  let score = 0;

  // Power score (0–40 pts): 150 kW = 20, 350 kW = 40
  score += Math.min(40, (station.maxPowerKw / 350) * 40);

  // Stall score (0–20 pts): 8+ stalls = 20
  if (station.totalStalls != null) {
    score += Math.min(20, (station.totalStalls / 8) * 20);
  } else {
    score += 10; // neutral if unknown
  }

  // Detour penalty (0–20 pts deducted): 0 km = 0 penalty, 3 km = 20 penalty
  score -= Math.min(20, (detourKm / CORRIDOR_BUFFER_KM) * 20);

  // Position bonus (0–20 pts): slightly prefer stations in the middle of the route
  // so the user gets options spread along the journey rather than clustered at start/end
  const relativePosition = distanceAlongRouteKm / totalRouteKm;
  const positionBonus = 20 - Math.abs(relativePosition - 0.5) * 40;
  score += Math.max(0, positionBonus);

  return Math.round(score);
}
