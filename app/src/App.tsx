import { useState, useEffect, useRef, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { RouteInput } from './components/RouteInput/RouteInput';
import { StationList } from './components/StationList/StationList';
import { MapView } from './components/MapView/MapView';
import { useRoute } from './hooks/useRoute';
import { useStations } from './hooks/useStations';
import { useAvailability } from './hooks/useAvailability';
import { useGeolocation } from './hooks/useGeolocation';
import { projectOntoRoute, type RouteProjection } from './utils/routeProjection';
import styles from './App.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

// How far off the polyline (metres) before we consider the user off-route
const OFF_ROUTE_THRESHOLD_M = 500;
// How long the user must stay off-route before we offer to recalculate (ms)
const OFF_ROUTE_GRACE_MS = 30_000;
// Minimum position change (metres) before we bother re-projecting
const MIN_MOVE_M = 30;

export function App() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'map'>('list');

  // Location tracking
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [userProjection, setUserProjection] = useState<RouteProjection | null>(null);
  const [showOffRouteBanner, setShowOffRouteBanner] = useState(false);
  const [dismissedUntil, setDismissedUntil] = useState(0);

  const offRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  const routeQuery = useRoute(origin, destination);
  const stationsQuery = useStations(
    routeQuery.data?.id,
    routeQuery.data?.decodedPath ?? [],
    routeQuery.data?.distanceMeters ?? 0,
  );
  const { availabilityMap, pendingIds, secondsUntilRefresh } = useAvailability(stationsQuery.data ?? []);
  const { position, permissionState } = useGeolocation(trackingEnabled);

  // Reset tracking when a new route is searched
  useEffect(() => {
    setTrackingEnabled(false);
    setUserProjection(null);
    setShowOffRouteBanner(false);
    lastPositionRef.current = null;
    if (offRouteTimerRef.current) clearTimeout(offRouteTimerRef.current);
  }, [origin, destination]);

  // Project user position onto route whenever GPS updates
  const decodedPath = routeQuery.data?.decodedPath;
  useEffect(() => {
    if (!position || !decodedPath?.length) return;

    const { latitude: lat, longitude: lng } = position;

    // Skip if user hasn't moved enough to matter
    if (lastPositionRef.current) {
      const dLat = (lat - lastPositionRef.current.lat) * 111_000;
      const dLng = (lng - lastPositionRef.current.lng) * 111_000;
      if (Math.sqrt(dLat * dLat + dLng * dLng) < MIN_MOVE_M) return;
    }
    lastPositionRef.current = { lat, lng };

    const projection = projectOntoRoute(lat, lng, decodedPath);
    setUserProjection(projection);

    // Off-route detection
    const isOffRoute = projection.distanceFromRouteMeters > OFF_ROUTE_THRESHOLD_M;
    const bannerDismissed = Date.now() < dismissedUntil;

    if (isOffRoute && !bannerDismissed) {
      if (!offRouteTimerRef.current) {
        offRouteTimerRef.current = setTimeout(() => {
          setShowOffRouteBanner(true);
          offRouteTimerRef.current = null;
        }, OFF_ROUTE_GRACE_MS);
      }
    } else {
      if (offRouteTimerRef.current) {
        clearTimeout(offRouteTimerRef.current);
        offRouteTimerRef.current = null;
      }
      if (!isOffRoute) setShowOffRouteBanner(false);
    }
  }, [position, decodedPath, dismissedUntil]);

  function handleRouteSubmit(newOrigin: string, newDestination: string) {
    setSelectedStationId(null);
    setOrigin(newOrigin);
    setDestination(newDestination);
  }

  function handleStationSelect(id: number | null) {
    setSelectedStationId(id);
    if (id !== null) setActiveView('map');
  }

  const handleRecalculate = useCallback(() => {
    if (!position) return;
    const { latitude, longitude } = position;
    setOrigin(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
    setSelectedStationId(null);
    setShowOffRouteBanner(false);
    setUserProjection(null);
    lastPositionRef.current = null;
  }, [position]);

  function handleDismissOffRoute() {
    setShowOffRouteBanner(false);
    setDismissedUntil(Date.now() + 5 * 60 * 1000); // 5 min
    if (offRouteTimerRef.current) {
      clearTimeout(offRouteTimerRef.current);
      offRouteTimerRef.current = null;
    }
  }

  const isLoading = routeQuery.isLoading || stationsQuery.isLoading;
  const error = routeQuery.error || stationsQuery.error;
  const hasRoute = Boolean(routeQuery.data);

  const sidebarClass = [
    styles.sidebar,
    activeView === 'list' ? styles.activeMobile : styles.thumbnailMobile,
  ].join(' ');

  const mapAreaClass = [
    styles.mapArea,
    activeView === 'map' ? styles.activeMobile : styles.thumbnailMobile,
  ].join(' ');

  return (
    <APIProvider apiKey={GOOGLE_API_KEY}>
    <div className={styles.layout}>

      <aside
        className={sidebarClass}
        onClick={activeView === 'map' ? () => setActiveView('list') : undefined}
      >
        <header className={styles.header}>
          <div className={styles.titleRow}>
            <div>
              <h1 className={styles.title}>Freeway Charge</h1>
              <p className={styles.subtitle}>Charging stations along your route</p>
            </div>
            {hasRoute && permissionState !== 'denied' && permissionState !== 'unsupported' && (
              <button
                className={`${styles.trackBtn} ${trackingEnabled ? styles.trackBtnActive : ''}`}
                onClick={(e) => { e.stopPropagation(); setTrackingEnabled(v => !v); }}
                title={trackingEnabled ? 'Stop tracking location' : 'Track my position'}
              >
                {trackingEnabled ? '📍' : '📍'}
                <span>{trackingEnabled ? 'Tracking' : 'Track'}</span>
              </button>
            )}
            {permissionState === 'denied' && (
              <span className={styles.locationDenied} title="Location permission denied">No location</span>
            )}
          </div>
        </header>

        <RouteInput onSubmit={handleRouteSubmit} isLoading={isLoading} />

        {error && (
          <div className={styles.error}>
            {(error as Error).message}
          </div>
        )}

        {showOffRouteBanner && (
          <div className={styles.offRouteBanner}>
            <span>You've left the planned route.</span>
            <div className={styles.offRouteBannerActions}>
              <button className={styles.offRouteRecalc} onClick={handleRecalculate}>
                Recalculate
              </button>
              <button className={styles.offRouteDismiss} onClick={handleDismissOffRoute}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {routeQuery.data && (
          <div className={styles.routeMeta}>
            <span>{(routeQuery.data.distanceMeters / 1000).toFixed(0)} km</span>
            <span>{Math.round(routeQuery.data.durationSeconds / 60)} min</span>
            {stationsQuery.data && (
              <span>{stationsQuery.data.length} stations</span>
            )}
          </div>
        )}

        {stationsQuery.isLoading && (
          <p className={styles.loading}>Finding charging stations...</p>
        )}

        {stationsQuery.data && (
          <>
            {secondsUntilRefresh !== null && (
              <p className={styles.refreshCountdown}>
                Availability refreshes in {secondsUntilRefresh}s
              </p>
            )}
            <StationList
              stations={stationsQuery.data}
              selectedId={selectedStationId}
              onSelect={handleStationSelect}
              availabilityMap={availabilityMap}
              pendingIds={pendingIds}
              userProjection={userProjection}
            />
          </>
        )}

        {/* Thumbnail label — only visible on mobile when this view is inactive */}
        <div className={styles.thumbnailLabel}>List</div>
      </aside>

      <main
        className={mapAreaClass}
        onClick={activeView === 'list' ? () => setActiveView('map') : undefined}
      >
        <MapView
          route={routeQuery.data ?? null}
          stations={stationsQuery.data ?? []}
          selectedStationId={selectedStationId}
          onStationSelect={setSelectedStationId}
          userPosition={position ? { lat: position.latitude, lng: position.longitude } : null}
        />

        {/* Thumbnail label — only visible on mobile when this view is inactive */}
        <div className={styles.thumbnailLabel}>Map</div>
      </main>

    </div>
    </APIProvider>
  );
}
