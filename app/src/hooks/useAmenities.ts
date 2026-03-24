import { useState, useEffect, useMemo } from 'react';
import type { StationOnRoute, Amenity } from '../types/station';
import { WORKER_URL } from '../config';

export function useAmenities(stations: StationOnRoute[]): Map<string, Amenity[]> {
  const [amenityMap, setAmenityMap] = useState<Map<string, Amenity[]>>(new Map());

  // Stable key — only re-fetch when station IDs actually change
  const stationKey = useMemo(
    () => stations.map(s => s.station.id).join(','),
    [stations],
  );

  useEffect(() => {
    if (!stationKey) return;

    const payload = stations.map(s => ({
      id: s.station.id,
      lat: s.station.lat,
      lng: s.station.lng,
    }));

    fetch(`${WORKER_URL}/api/stations/amenities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => r.json())
      .then((data: Record<string, Amenity[]>) => {
        const map = new Map<string, Amenity[]>();
        for (const [id, amenities] of Object.entries(data)) {
          if (amenities.length > 0) map.set(id, amenities);
        }
        setAmenityMap(map);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationKey]);

  return amenityMap;
}
