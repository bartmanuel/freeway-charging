import { Map, Marker, InfoWindow, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useState, useEffect } from 'react';
import type { Route } from '../../types/route';
import type { StationOnRoute, StationAvailability, ConnectorAvailability, Amenity } from '../../types/station';
import { getMarkerIcon, getListLogoSvg } from '../../utils/operatorIcon';
import { getBrandConfig } from '../../utils/amenityIcon';
import styles from './MapView.module.css';

const DEFAULT_CENTER = { lat: 51.5, lng: 8.0 };
const DEFAULT_ZOOM = 6;

// Pans and zooms the map when the selected station changes.
function StationFocus({
  stations,
  selectedStationId,
}: {
  stations: StationOnRoute[];
  selectedStationId: string | null;
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

function availClass(c: ConnectorAvailability): string {
  const usable = c.total - c.outOfService;
  if (usable === 0) return styles.infoAvailNone;
  const ratio = c.available / usable;
  if (ratio > 0.5) return styles.infoAvailGood;
  if (ratio > 0) return styles.infoAvailPartial;
  return styles.infoAvailFull;
}

interface Props {
  route: Route | null;
  stations: StationOnRoute[];
  selectedStationId: string | null;
  onStationSelect: (id: string) => void;
  userPosition: { lat: number; lng: number } | null;
  availabilityMap?: Map<string, StationAvailability>;
  amenityMap?: Map<string, Amenity[]>;
  tripDestination?: string; // final destination of the trip, used for navigation deep-links
}

export function MapView({ route, stations, selectedStationId, onStationSelect, userPosition, availabilityMap, amenityMap, tripDestination }: Props) {
  const [infoWindowStationId, setInfoWindowStationId] = useState<string | null>(null);

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

          {userPosition && (
            <Marker
              position={userPosition}
              icon={{
                path: 'M 0,0 m -8,0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0',
                fillColor: '#2563eb',
                fillOpacity: 1,
                strokeColor: 'white',
                strokeWeight: 2,
                scale: 1,
              }}
            />
          )}

          {stations.map(({ station }) => (
            <Marker
              key={station.id}
              position={{ lat: station.lat, lng: station.lng }}
              title={station.name}
              onClick={() => {
                onStationSelect(station.id);
                setInfoWindowStationId(station.id);
              }}
              icon={getMarkerIcon(station.operator)}
            />
          ))}

          {infoWindowStationId != null && (() => {
            const found = stations.find((s) => s.station.id === infoWindowStationId);
            if (!found) return null;
            const { station, detourMeters } = found;
            const availability = availabilityMap?.get(station.id);
            const amenities = amenityMap?.get(station.id) ?? [];

            // Google Maps: add station as a waypoint (stop) before the trip's final destination.
            // Using waypoints= keeps the original destination in the route rather than replacing it.
            const gmapsUrl = tripDestination
              ? `https://www.google.com/maps/dir/?api=1&waypoints=${station.lat},${station.lng}&destination=${encodeURIComponent(tripDestination)}&travelmode=driving`
              : `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}&travelmode=driving`;

            // Waze: its URL scheme only supports a single destination, not intermediate stops.
            // Navigate to the station so the driver can resume their trip afterwards.
            const wazeUrl = `https://waze.com/ul?ll=${station.lat},${station.lng}&navigate=yes`;

            // Stall count: prefer availability total (more accurate) over OCM stalls
            const stallsCount = availability?.connectors[0]?.total ?? station.totalStalls;

            // Unique amenity brands (top 5)
            const seenBrands = new Set<string>();
            const uniqueAmenities = amenities.filter(a => {
              if (seenBrands.has(a.brand)) return false;
              seenBrands.add(a.brand);
              return true;
            }).slice(0, 5);

            return (
              <InfoWindow
                position={{ lat: station.lat, lng: station.lng }}
                onCloseClick={() => setInfoWindowStationId(null)}
              >
                <div className={styles.infoWindow}>
                  {/* Header: logo + name + power */}
                  <div className={styles.infoHeader}>
                    <span
                      className={styles.infoLogo}
                      dangerouslySetInnerHTML={{ __html: getListLogoSvg(station.operator) }}
                      title={station.operator ?? 'Unknown operator'}
                    />
                    <div className={styles.infoTitle}>
                      <strong className={styles.infoName}>{station.name}</strong>
                      {station.operator && (
                        <span className={styles.infoOperator}>{station.operator}</span>
                      )}
                    </div>
                    <span className={styles.infoPower}>{station.maxPowerKw} kW</span>
                  </div>

                  {/* Stalls + detour */}
                  <div className={styles.infoMeta}>
                    {stallsCount != null && <span>{stallsCount} stalls</span>}
                    {detourMeters > 100 && (
                      <span>+{(detourMeters / 1000).toFixed(1)} km detour</span>
                    )}
                  </div>

                  {/* Live availability badges */}
                  {availability && (
                    <div className={styles.infoAvailRow}>
                      {availability.connectors.map(c => (
                        <span
                          key={c.type}
                          className={`${styles.infoAvailBadge} ${availClass(c)}`}
                          title={`${c.available} of ${c.total} available`}
                        >
                          {c.available}/{c.total} {c.typeLabel}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Amenities */}
                  {uniqueAmenities.length > 0 && (
                    <div className={styles.infoAmenityRow}>
                      {uniqueAmenities.map(a => {
                        const cfg = getBrandConfig(a.brand);
                        if (!cfg) return null;
                        return (
                          <span
                            key={a.brand}
                            className={styles.infoAmenityPill}
                            style={{ background: cfg.bg, color: cfg.fg }}
                            title={`${cfg.label} (~${a.distance} m)`}
                          >
                            {cfg.label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Navigation links */}
                  <div className={styles.infoNavRow}>
                    <a
                      href={gmapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${styles.infoNavBtn} ${styles.infoNavGoogle}`}
                    >
                      Google Maps
                    </a>
                    <a
                      href={wazeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${styles.infoNavBtn} ${styles.infoNavWaze}`}
                    >
                      Waze
                    </a>
                  </div>
                </div>
              </InfoWindow>
            );
          })()}
      </Map>
    </div>
  );
}
