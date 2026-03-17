import { Map, Marker, InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useState, useEffect } from 'react';
import type { Route } from '../../types/route';
import type { StationOnRoute } from '../../types/station';
import styles from './MapView.module.css';

const DEFAULT_CENTER = { lat: 51.5, lng: 8.0 };
const DEFAULT_ZOOM = 6;

// Pans and zooms the map when the selected station changes.
function StationFocus({
  stations,
  selectedStationId,
}: {
  stations: StationOnRoute[];
  selectedStationId: number | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || selectedStationId === null) return;
    const found = stations.find((s) => s.station.id === selectedStationId);
    if (!found) return;
    map.panTo({ lat: found.station.lat, lng: found.station.lng });
    map.setZoom(14);
  }, [map, stations, selectedStationId]);

  return null;
}

// Draws the route polyline imperatively via the Maps API.
function RoutePolyline({ path }: { path: { lat: number; lng: number }[] }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');

  useEffect(() => {
    if (!map || !mapsLib || path.length < 2) return;

    const polyline = new mapsLib.Polyline({
      path,
      strokeColor: '#2563eb',
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map,
    });

    return () => polyline.setMap(null);
  }, [map, mapsLib, path]);

  return null;
}

interface Props {
  route: Route | null;
  stations: StationOnRoute[];
  selectedStationId: number | null;
  onStationSelect: (id: number) => void;
}

export function MapView({ route, stations, selectedStationId, onStationSelect }: Props) {
  const [infoWindowStationId, setInfoWindowStationId] = useState<number | null>(null);

  const center = route
    ? route.decodedPath[Math.floor(route.decodedPath.length / 2)]
    : DEFAULT_CENTER;

  return (
    <div className={styles.mapContainer}>
      <Map
          defaultCenter={center}
          defaultZoom={route ? 8 : DEFAULT_ZOOM}
          gestureHandling="greedy"
        >
          {route && <RoutePolyline path={route.decodedPath} />}
          <StationFocus stations={stations} selectedStationId={selectedStationId} />

          {stations.map(({ station }) => (
            <Marker
              key={station.id}
              position={{ lat: station.lat, lng: station.lng }}
              title={station.name}
              onClick={() => {
                onStationSelect(station.id);
                setInfoWindowStationId(station.id);
              }}
              icon={{
                url:
                  station.maxPowerKw >= 250
                    ? 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
                    : station.maxPowerKw >= 150
                      ? 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
                      : 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png',
              }}
            />
          ))}

          {infoWindowStationId != null && (() => {
            const found = stations.find((s) => s.station.id === infoWindowStationId);
            if (!found) return null;
            const { station, detourMeters } = found;
            return (
              <InfoWindow
                position={{ lat: station.lat, lng: station.lng }}
                onCloseClick={() => setInfoWindowStationId(null)}
              >
                <div className={styles.infoWindow}>
                  <strong>{station.name}</strong>
                  <span>{station.maxPowerKw} kW max</span>
                  {station.totalStalls != null && <span>{station.totalStalls} stalls</span>}
                  {station.operator && <span>{station.operator}</span>}
                  {detourMeters > 100 && (
                    <span>+{(detourMeters / 1000).toFixed(1)} km detour</span>
                  )}
                </div>
              </InfoWindow>
            );
          })()}
      </Map>
    </div>
  );
}
