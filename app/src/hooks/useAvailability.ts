import { useState, useEffect, useRef, useCallback } from 'react';
import type { StationOnRoute, StationAvailability, HistoryPoint, ConnectorAvailability } from '../types/station';

const WORKER_URL = 'https://freeway-charge-api.bartmanuel.workers.dev';
const POLL_INTERVAL_MS = 60_000; // 60s — matches TomTom's 3-min cache with headroom
const POLL_INTERVAL_S = POLL_INTERVAL_MS / 1000;

export interface AvailabilityState {
  availabilityMap: Map<number, StationAvailability>;
  pendingIds: Set<number>;
  secondsUntilRefresh: number | null; // null when tab hidden or polling not yet started
}

/**
 * Fetches live CCS2 availability for all stations from the Worker, then
 * re-polls every 60 s. Pauses when the tab is hidden; resumes immediately
 * on becoming visible again.
 */
export function useAvailability(stations: StationOnRoute[]): AvailabilityState {
  const [availabilityMap, setAvailabilityMap] = useState<Map<number, StationAvailability>>(new Map());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  function startCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setSecondsUntilRefresh(POLL_INTERVAL_S);
    countdownRef.current = setInterval(() => {
      setSecondsUntilRefresh(s => (s !== null && s > 1 ? s - 1 : null));
    }, 1_000);
  }

  function stopCountdown() {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    setSecondsUntilRefresh(null);
  }

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

      const data = await res.json() as Record<string, { connectors: ConnectorAvailability[] | null; history: HistoryPoint[] }>;

      setAvailabilityMap(prev => {
        const next = new Map<number, StationAvailability>(prev);
        for (const [idStr, { connectors, history }] of Object.entries(data)) {
          const id = Number(idStr);
          if (connectors?.length) {
            next.set(id, {
              fetchedAt: new Date().toISOString(),
              connectors,
              history: history ?? [],
            });
          } else if (prev.has(id)) {
            // Keep stale availability but update history if newer data arrived
            const existing = prev.get(id)!;
            if (history?.length) {
              next.set(id, { ...existing, history });
            }
          }
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
    fetchAll(true).then(startCountdown);

    function scheduleNext() {
      timerRef.current = setTimeout(async () => {
        // Skip poll if tab is hidden — resume on next visibilitychange
        if (document.visibilityState === 'hidden') {
          stopCountdown();
          return;
        }
        await fetchAll(false);
        startCountdown();
        scheduleNext();
      }, POLL_INTERVAL_MS);
    }

    scheduleNext();

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      // Tab became visible — clear pending timer and re-fetch immediately
      if (timerRef.current) clearTimeout(timerRef.current);
      fetchAll(false).then(() => {
        startCountdown();
        scheduleNext();
      });
    }

    function onHidden() {
      if (document.visibilityState === 'hidden') stopCountdown();
    }

    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      stopCountdown();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [stations, fetchAll]);

  return { availabilityMap, pendingIds, secondsUntilRefresh };
}
