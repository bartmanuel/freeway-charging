import { useQuery } from '@tanstack/react-query';
import { computeRoute } from '../services/routeService';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

export function useRoute(origin: string, destination: string) {
  return useQuery({
    queryKey: ['route', origin, destination],
    queryFn: () => computeRoute(origin, destination, GOOGLE_API_KEY),
    enabled: Boolean(origin && destination),
    staleTime: 1000 * 60 * 60 * 24 * 30, // 30 days — per Google ToS
    retry: 1,
  });
}
