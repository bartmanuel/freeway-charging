import { useQuery } from '@tanstack/react-query';
import type { LatLng } from '../types/route';
import { fetchStationsAlongRoute } from '../services/ocmService';
import { findStationsAlongRoute } from '../services/corridorSearch';
import { rankAndFilter } from '../services/stationRanker';

const OCM_API_KEY = import.meta.env.VITE_OCM_API_KEY as string;

export function useStations(routeId: string | undefined, decodedPath: LatLng[], routeLengthMeters: number) {
  return useQuery({
    queryKey: ['stations', routeId],
    queryFn: async () => {
      const rawStations = await fetchStationsAlongRoute(decodedPath, OCM_API_KEY);
      const stationsOnRoute = findStationsAlongRoute(decodedPath, rawStations);
      return rankAndFilter(stationsOnRoute, routeLengthMeters);
    },
    enabled: Boolean(routeId && decodedPath.length > 1),
    staleTime: 1000 * 60 * 60 * 24, // 24h for station data
    retry: 1,
  });
}
