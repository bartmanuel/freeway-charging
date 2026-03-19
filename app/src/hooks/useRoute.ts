import { useQuery } from '@tanstack/react-query';
import { computeRoute } from '../services/routeService';

export function useRoute(origin: string, destination: string) {
  return useQuery({
    queryKey: ['route', origin, destination],
    queryFn: () => computeRoute(origin, destination),
    enabled: Boolean(origin && destination),
    staleTime: 1000 * 60 * 60 * 24 * 30, // 30 days — Worker caches in Redis for same TTL
    retry: 1,
  });
}
