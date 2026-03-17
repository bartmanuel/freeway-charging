import type { StationOnRoute } from '../types/station';

// Exclude stations within this distance of the route origin or destination.
// Catches city-centre chargers near the start/end point that aren't highway stops.
const ENDPOINT_EXCLUSION_METERS = 8000;

// Returns stations that qualify as high-capacity charging stops,
// with progressive fallback if not enough are found.
export function rankAndFilter(
  stationsOnRoute: StationOnRoute[],
  routeLengthMeters: number,
  minCount = 3,
): StationOnRoute[] {
  const endThreshold = routeLengthMeters - ENDPOINT_EXCLUSION_METERS;

  const highwayStops = stationsOnRoute.filter(
    (s) =>
      s.distanceAlongRouteMeters >= ENDPOINT_EXCLUSION_METERS &&
      s.distanceAlongRouteMeters <= endThreshold,
  );

  const pool = highwayStops.length >= minCount ? highwayStops : stationsOnRoute;

  const thresholds = [150, 100, 50]; // kW — progressively relax per dev plan

  for (const minKw of thresholds) {
    const qualified = pool.filter((s) => s.station.maxPowerKw >= minKw);
    if (qualified.length >= minCount) {
      return qualified.sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
    }
  }

  return [...pool].sort((a, b) => a.distanceAlongRouteMeters - b.distanceAlongRouteMeters);
}
