import { useState, useEffect, useRef } from 'react';
import type { StationOnRoute, StationAvailability } from '../types/station';
import { lookupAndFetchAvailability } from '../services/tomtomService';

const TOMTOM_API_KEY = (import.meta.env.VITE_TOMTOM_API_KEY as string | undefined)?.trim() ?? '';
const STAGGER_MS = 150; // delay between requests to avoid hammering TomTom

export interface AvailabilityState {
  availabilityMap: Map<number, StationAvailability>;
  pendingIds: Set<number>;
}

/**
 * Enriches a list of stations with live availability data from TomTom.
 * Fires requests staggered in the background; returns a map that fills in
 * as each resolves, plus a set of IDs still in flight.
 * Cancels in-flight requests if the station list changes.
 */
export function useAvailability(stations: StationOnRoute[]): AvailabilityState {
  const [availabilityMap, setAvailabilityMap] = useState<Map<number, StationAvailability>>(new Map());
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!stations.length || !TOMTOM_API_KEY) return;

    cancelledRef.current = false;
    setAvailabilityMap(new Map());
    setPendingIds(new Set(stations.map(s => s.station.id)));

    stations.forEach(({ station }, index) => {
      setTimeout(async () => {
        if (cancelledRef.current) return;
        const availability = await lookupAndFetchAvailability(station, TOMTOM_API_KEY);
        if (cancelledRef.current) return;
        if (availability) {
          setAvailabilityMap(prev => new Map(prev).set(station.id, availability));
        }
        setPendingIds(prev => {
          const next = new Set(prev);
          next.delete(station.id);
          return next;
        });
      }, index * STAGGER_MS);
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [stations]);

  return { availabilityMap, pendingIds };
}
