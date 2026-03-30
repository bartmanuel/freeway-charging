import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { StationOnRoute, StationAvailability, HistoryPoint, ConnectorAvailability } from '../types/station';

import { WORKER_URL } from '../config';

const POLL_INTERVAL_MS = 60_000; // 60s — matches TomTom's 3-min cache with headroom
const POLL_INTERVAL_S = POLL_INTERVAL_MS / 1000;

export interface AvailabilityState {
  availabilityMap: Map<string, StationAvailability>;
  pendingIds: Set<string>;
  secondsUntilRefresh: number | null; // null when tab hidden or polling not yet started
}

type StationPayload = {
  id: string;
  lat: number;
  lng: number;
  name: string;
  operator: string | null;
  connectors: { type: string; powerKw: number | null }[];
  totalStalls: number | null;
};

/**
 * Fetches live CCS2 availability for all stations from the Worker, then
 * re-polls every 60 s. Pauses when the tab is hidden; resumes immediately
 * on becoming visible again.
 *
 * When `selectedStationId` is provided and that station has no data yet,
 * an immediate single-station fetch is triggered.
 */
export function useAvailability(
  stations: StationOnRoute[],
  selectedStationId?: string | null,
): AvailabilityState {
  const [availabilityMap, setAvailabilityMap] = useState<Map<string, StationAvailability>>(new Map());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;

  // Stable key: only triggers reset when station IDs actually change,
  // not when the array reference is recreated with the same content.
  const stationIds = useMemo(
    () => stations.map(s => s.station.id).join(','),
    [stations],
  );

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

  async function postAvailability(
    body: StationPayload[],
  ): Promise<Record<string, { connectors: ConnectorAvailability[] | null; history: HistoryPoint[]; fetchedAt: string }>> {
    const res = await fetch(`${WORKER_URL}/api/stations/availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return {};
    return res.json();
  }

  function mergeResults(
    prev: Map<string, StationAvailability>,
    data: Record<string, { connectors: ConnectorAvailability[] | null; history: HistoryPoint[]; fetchedAt: string }>,
  ): Map<string, StationAvailability> {
    const next = new Map<string, StationAvailability>(prev);
    for (const [id, { connectors, history, fetchedAt }] of Object.entries(data)) {
      if (connectors?.length) {
        const existingHistory = prev.get(id)?.history ?? [];
        // Prepend a "current bar" using the Worker server's fetchedAt timestamp
        // (same UTC clock source as Supabase sampled_at — not the browser clock).
        // This gives an immediate rightmost bar on the first poll while keeping
        // all subsequent bars aligned on a single clock source, preventing the
        // negative-minsAgo filtering that occurred when mixing client and server times.
        const ccs2 = connectors[0];
        const currentBar: HistoryPoint = { ts: fetchedAt, avail: ccs2.available, total: ccs2.total };
        const newHistory = [currentBar, ...(history ?? [])];
        // Keep the richer history so a transient Supabase error can't wipe the chart.
        next.set(id, {
          fetchedAt,
          connectors,
          history: newHistory.length >= existingHistory.length ? newHistory : existingHistory,
        });
      } else if (prev.has(id)) {
        const existing = prev.get(id)!;
        const newHistory = history ?? [];
        if (newHistory.length >= existing.history.length) {
          next.set(id, { ...existing, history: newHistory });
        }
      }
    }
    return next;
  }

  const fetchAll = useCallback(async (isFirstFetch: boolean) => {
    const current = stationsRef.current;
    if (!current.length) return;

    if (isFirstFetch) {
      setPendingIds(new Set(current.map(s => s.station.id)));
    }

    const body = current.map(({ station }) => ({
      id: String(station.id),
      lat: station.lat,
      lng: station.lng,
      name: station.name,
      operator: station.operator,
      connectors: station.connectors,
      totalStalls: station.totalStalls,
    }));

    try {
      const data = await postAvailability(body);
      setAvailabilityMap(prev => mergeResults(prev, data));
    } finally {
      if (isFirstFetch) {
        setPendingIds(new Set());
      }
    }
  }, []);

  // Main polling effect — keyed on stable station IDs, not array reference
  useEffect(() => {
    if (!stationIds) return;

    setAvailabilityMap(new Map());
    fetchAll(true).then(startCountdown);

    function scheduleNext() {
      timerRef.current = setTimeout(async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationIds, fetchAll]);

  // Auto-fetch for a selected station that has no availability data yet
  useEffect(() => {
    if (!selectedStationId) return;
    // Already have data or already pending
    if (availabilityMap.has(selectedStationId)) return;
    if (pendingIds.has(selectedStationId)) return;

    const found = stationsRef.current.find(s => s.station.id === selectedStationId);
    if (!found) return;

    const { station } = found;
    setPendingIds(prev => new Set([...prev, station.id]));

    const body: StationPayload[] = [{
      id: String(station.id),
      lat: station.lat,
      lng: station.lng,
      name: station.name,
      operator: station.operator,
      connectors: station.connectors,
      totalStalls: station.totalStalls,
    }];

    postAvailability(body)
      .then(data => setAvailabilityMap(prev => mergeResults(prev, data)))
      .finally(() => setPendingIds(prev => {
        const next = new Set(prev);
        next.delete(station.id);
        return next;
      }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStationId]);

  return { availabilityMap, pendingIds, secondsUntilRefresh };
}
