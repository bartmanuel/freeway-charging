import { useState, useEffect, useRef, useCallback } from 'react';
import type { StationOnRoute, StationAvailability, ConnectorAvailability } from '../types/station';

const WORKER_URL = 'https://freeway-charge-api.bartmanuel.workers.dev';
const POLL_INTERVAL_MS = 60_000; // 60s — matches TomTom's 3-min cache with headroom

export interface AvailabilityState {
  availabilityMap: Map<number, StationAvailability>;
  pendingIds: Set<number>;
}

/**
 * Fetches live CCS2 availability for all stations from the Worker, then
 * re-polls every 60 s. Pauses when the tab is hidden; resumes immediately
 * on becoming visible again.
 */
export function useAvailability(stations: StationOnRoute[]): AvailabilityState {
  const [availabilityMap, setAvailabilityMap] = useState<Map<number, StationAvailability>>(new Map());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  const fetchAll = useCallback(async (isFirstFetch: boolean) => {
    const current = stationsRef.current;
    if (!current.length) return;

    if (isFirstFetch) {
      setPendingIds(new Set(current.map(s => s.station.id)));
    }

    // Build payload: only the fields the Worker needs for ID lookup + matching
    const body = current.map(({ station }) => ({
      id: String(station.id),
      lat: station.lat,
      lng: station.lng,
      name: station.name,
      operator: station.operator,
      connectors: station.connectors,
    }));

    try {
      const res = await fetch(`${WORKER_URL}/api/stations/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) return;

      const data = await res.json() as Record<string, ConnectorAvailability[] | null>;

      setAvailabilityMap(() => {
        const next = new Map<number, StationAvailability>();
        for (const [idStr, connectors] of Object.entries(data)) {
          if (!connectors?.length) continue;
          next.set(Number(idStr), {
            fetchedAt: new Date().toISOString(),
            connectors,
          });
        }
        return next;
      });
    } finally {
      if (isFirstFetch) {
        setPendingIds(new Set());
      }
    }
  }, []);

  useEffect(() => {
    if (!stations.length) return;

    setAvailabilityMap(new Map());
    fetchAll(true);

    function scheduleNext() {
      timerRef.current = setTimeout(async () => {
        // Skip poll if tab is hidden — resume on next visibilitychange
        if (document.visibilityState === 'hidden') return;
        await fetchAll(false);
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    scheduleNext();

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      // Tab became visible — clear pending timer and re-fetch immediately
      if (timerRef.current) clearTimeout(timerRef.current);
      fetchAll(false).then(scheduleNext);
    }

    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [stations, fetchAll]);

  return { availabilityMap, pendingIds };
}
