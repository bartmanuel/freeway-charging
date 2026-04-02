import { useState, useEffect, useRef, useCallback } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { LocationOnboarding } from './components/LocationOnboarding/LocationOnboarding';
import { DestinationSearch } from './components/DestinationSearch/DestinationSearch';
import { ResumeTripScreen } from './components/ResumeTripScreen/ResumeTripScreen';
import { StationList } from './components/StationList/StationList';
import { MapView } from './components/MapView/MapView';
import { useRoute } from './hooks/useRoute';
import { useStations } from './hooks/useStations';
import { useAvailability } from './hooks/useAvailability';
import { useAmenities } from './hooks/useAmenities';
import { useGeolocation } from './hooks/useGeolocation';
import { projectOntoRoute, type RouteProjection } from './utils/routeProjection';
import styles from './App.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

// ── Trip persistence ───────────────────────────────────────────────────────────
const SAVED_TRIP_KEY = 'ljd_active_trip';
const SAVED_TRIP_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

interface SavedTrip {
  destination: string;
  origin: string;
  destName: string;
  savedAt: number;
}

function loadSavedTrip(): SavedTrip | null {
  try {
    const raw = localStorage.getItem(SAVED_TRIP_KEY);
    if (!raw) return null;
    const data: SavedTrip = JSON.parse(raw);
    if (Date.now() - data.savedAt > SAVED_TRIP_MAX_AGE_MS) {
      localStorage.removeItem(SAVED_TRIP_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

// How far off the polyline (metres) before we consider the user off-route
const OFF_ROUTE_THRESHOLD_M = 500;
// How long the user must stay off-route before we offer to recalculate (ms)
const OFF_ROUTE_GRACE_MS = 30_000;
// Minimum position change (metres) before we bother re-projecting
const MIN_MOVE_M = 30;

function formatDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${m.toString().padStart(2, '0')}`;
}

type Screen = 'onboarding' | 'start' | 'resume' | 'trip';

export function App() {
  // Lazy initializers so the correct screen shows immediately with no flash.
  const [resumeData] = useState<SavedTrip | null>(loadSavedTrip);
  const [screen, setScreen] = useState<Screen>(() => resumeData ? 'resume' : 'onboarding');
  const [destinationPlace, setDestinationPlace] = useState<google.maps.places.PlaceResult | null>(null);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'map'>('list');
  const [thumbPos, setThumbPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    startX: number; startY: number;
    elemX: number;  elemY: number;
    isDragging: boolean;
  } | null>(null);

  // Location tracking
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
  const { availabilityMap, pendingIds } = useAvailability(
    stationsQuery.data ?? [],
    selectedStationId,
  );
  const amenityMap = useAmenities(stationsQuery.data ?? []);
  // Start geolocation as soon as the user reaches the start screen so the blue
  // dot is already warm by the time they pick a destination.
  // Start GPS on start/resume/trip so it's warm by the time the user acts.
  const { position, permissionState } = useGeolocation(
    screen === 'start' || screen === 'resume' || screen === 'trip'
  );

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

  // ── Draggable thumbnail ───────────────────────────────────────────────────
  const THUMB_W = 110;
  const THUMB_H = 164;

  function handleThumbPointerDown(e: React.PointerEvent) {
    if (window.innerWidth > 640) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, elemX: rect.left, elemY: rect.top, isDragging: false };
    el.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }

  function handleThumbPointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.sqrt(dx * dx + dy * dy) > 8) dragRef.current.isDragging = true;
    if (dragRef.current.isDragging) {
      const x = Math.max(0, Math.min(window.innerWidth - THUMB_W, dragRef.current.elemX + dx));
      const y = Math.max(0, Math.min(window.innerHeight - THUMB_H, dragRef.current.elemY + dy));
      setThumbPos({ x, y });
    }
  }

  function handleThumbPointerUp(e: React.PointerEvent, switchTo: 'list' | 'map') {
    if (!dragRef.current) return;
    if (!dragRef.current.isDragging) {
      setActiveView(switchTo);
      setThumbPos(null);
    }
    dragRef.current = null;
    e.stopPropagation();
  }
  // ─────────────────────────────────────────────────────────────────────────

  const handleOnboardingGranted = useCallback(() => setScreen('start'), []);

  const handleConfirm = useCallback((place: google.maps.places.PlaceResult) => {
    if (!position) return;
    const { latitude, longitude } = position;
    const orig = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    const dest = place.formatted_address ?? place.name ?? '';
    setOrigin(orig);
    setDestination(dest);
    setDestinationPlace(place);
    setSelectedStationId(null);
    // Persist so we can offer resume if the app is closed mid-trip.
    localStorage.setItem(SAVED_TRIP_KEY, JSON.stringify({
      destination: dest,
      origin: orig,
      destName: place.name ?? dest,
      savedAt: Date.now(),
    } satisfies SavedTrip));
    setScreen('trip');
  }, [position]);

  const handleReroute = useCallback(() => {
    if (!position) return;
    const { latitude, longitude } = position;
    setOrigin(`${latitude.toFixed(6)},${longitude.toFixed(6)}`);
    setSelectedStationId(null);
    setShowOffRouteBanner(false);
    setUserProjection(null);
    lastPositionRef.current = null;
  }, [position]);

  function handleStop() {
    localStorage.removeItem(SAVED_TRIP_KEY);
    setScreen('start');
    setDestinationPlace(null);
    setOrigin('');
    setDestination('');
    setSelectedStationId(null);
    setUserProjection(null);
    setShowOffRouteBanner(false);
    setDismissedUntil(0);
    lastPositionRef.current = null;
    if (offRouteTimerRef.current) {
      clearTimeout(offRouteTimerRef.current);
      offRouteTimerRef.current = null;
    }
  }

  const handleResumeYes = useCallback(() => {
    if (!resumeData) return;
    // Prefer current GPS position as origin; fall back to the saved position.
    const orig = position
      ? `${position.latitude.toFixed(6)},${position.longitude.toFixed(6)}`
      : resumeData.origin;
    setOrigin(orig);
    setDestination(resumeData.destination);
    // Only .name is used in the trip header; no need for full PlaceResult geometry.
    setDestinationPlace({ name: resumeData.destName } as google.maps.places.PlaceResult);
    setSelectedStationId(null);
    setScreen('trip');
  }, [resumeData, position]);

  const handleResumeNo = useCallback(() => {
    localStorage.removeItem(SAVED_TRIP_KEY);
    setScreen('start');
  }, []);

  function handleStationSelect(id: string | null) {
    setSelectedStationId(id);
    if (id !== null) setActiveView('map');
  }

  function handleDismissOffRoute() {
    setShowOffRouteBanner(false);
    setDismissedUntil(Date.now() + 5 * 60 * 1000); // 5 min
    if (offRouteTimerRef.current) {
      clearTimeout(offRouteTimerRef.current);
      offRouteTimerRef.current = null;
    }
  }

  const error = routeQuery.error || stationsQuery.error;

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
      {screen === 'onboarding' && (
        <LocationOnboarding onGranted={handleOnboardingGranted} />
      )}

      {screen === 'resume' && resumeData && (
        <ResumeTripScreen
          destinationName={resumeData.destName}
          onYes={handleResumeYes}
          onNo={handleResumeNo}
        />
      )}

      {screen === 'start' && (
        <DestinationSearch
          onConfirm={handleConfirm}
          position={position}
          permissionState={permissionState}
        />
      )}

      {screen === 'trip' && (
        <div className={styles.layout}>
          <aside
            className={sidebarClass}
            style={activeView === 'map' && thumbPos ? { left: thumbPos.x, top: thumbPos.y, right: 'auto', bottom: 'auto' } : undefined}
            onPointerDown={activeView === 'map' ? handleThumbPointerDown : undefined}
            onPointerMove={activeView === 'map' ? handleThumbPointerMove : undefined}
            onPointerUp={activeView === 'map' ? (e) => handleThumbPointerUp(e, 'list') : undefined}
          >
            <div className={styles.slotContent}>
            <header className={styles.header}>
              <h1 className={styles.title}>
                let's just drive{destinationPlace ? ` to ${destinationPlace.name}` : ''}
              </h1>
              {routeQuery.data && (
                <div className={styles.routeMeta}>
                  <span>{(routeQuery.data.distanceMeters / 1000).toFixed(0)} km</span>
                  <span className={styles.routeMetaDivider}>|</span>
                  <span>{formatDuration(routeQuery.data.durationSeconds)}h</span>
                  {stationsQuery.data && (
                    <>
                      <span className={styles.routeMetaDivider}>|</span>
                      <span>
                        {stationsQuery.data.length}
                        <img src="/icons/in-app/charger-black.svg" className={styles.routeMetaIcon} alt="chargers" />
                      </span>
                    </>
                  )}
                </div>
              )}
              <div className={styles.tripControls}>
                <button
                  className={styles.rerouteBtn}
                  onClick={(e) => { e.stopPropagation(); handleReroute(); }}
                >
                  Reroute
                </button>
                <button
                  className={styles.stopBtn}
                  onClick={(e) => { e.stopPropagation(); handleStop(); }}
                >
                  Stop
                </button>
              </div>
            </header>

            {error && (
              <div className={styles.error}>
                {(error as Error).message}
              </div>
            )}

            {showOffRouteBanner && (
              <div className={styles.offRouteBanner}>
                <span>You've left the planned route.</span>
                <div className={styles.offRouteBannerActions}>
                  <button className={styles.offRouteRecalc} onClick={handleReroute}>
                    Recalculate
                  </button>
                  <button className={styles.offRouteDismiss} onClick={handleDismissOffRoute}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {stationsQuery.isLoading && (
              <p className={styles.loading}>Finding charging stations...</p>
            )}

            {stationsQuery.data && (
              <>
                <StationList
                  stations={stationsQuery.data}
                  selectedId={selectedStationId}
                  onSelect={handleStationSelect}
                  availabilityMap={availabilityMap}
                  pendingIds={pendingIds}
                  userProjection={userProjection}
                  amenityMap={amenityMap}
                />
              </>
            )}

            </div>{/* end slotContent */}

            {/* Thumbnail label — only visible on mobile when this view is inactive */}
            <div className={styles.thumbnailLabel}>List</div>
          </aside>

          <main
            className={mapAreaClass}
            style={activeView === 'list' && thumbPos ? { left: thumbPos.x, top: thumbPos.y, right: 'auto', bottom: 'auto' } : undefined}
            onPointerDown={activeView === 'list' ? handleThumbPointerDown : undefined}
            onPointerMove={activeView === 'list' ? handleThumbPointerMove : undefined}
            onPointerUp={activeView === 'list' ? (e) => handleThumbPointerUp(e, 'map') : undefined}
          >
            <MapView
              route={routeQuery.data ?? null}
              stations={stationsQuery.data ?? []}
              selectedStationId={selectedStationId}
              onStationSelect={setSelectedStationId}
              userPosition={position ? { lat: position.latitude, lng: position.longitude } : null}
              userProjection={userProjection}
              availabilityMap={availabilityMap}
              amenityMap={amenityMap}
              tripDestination={destination}
              activeView={activeView}
            />

            {/* Thumbnail label — only visible on mobile when this view is inactive */}
            <div className={styles.thumbnailLabel}>Map</div>
          </main>
        </div>
      )}

    </APIProvider>
  );
}
