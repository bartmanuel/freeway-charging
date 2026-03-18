import { useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { RouteInput } from './components/RouteInput/RouteInput';
import { StationList } from './components/StationList/StationList';
import { MapView } from './components/MapView/MapView';
import { useRoute } from './hooks/useRoute';
import { useStations } from './hooks/useStations';
import { useAvailability } from './hooks/useAvailability';
import styles from './App.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

export function App() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'map'>('list');

  const routeQuery = useRoute(origin, destination);
  const stationsQuery = useStations(routeQuery.data?.id, routeQuery.data?.decodedPath ?? [], routeQuery.data?.distanceMeters ?? 0);
  const { availabilityMap, pendingIds, secondsUntilRefresh } = useAvailability(stationsQuery.data ?? []);

  function handleRouteSubmit(newOrigin: string, newDestination: string) {
    setSelectedStationId(null);
    setOrigin(newOrigin);
    setDestination(newDestination);
  }

  function handleStationSelect(id: number | null) {
    setSelectedStationId(id);
    if (id !== null) setActiveView('map');
  }

  const isLoading = routeQuery.isLoading || stationsQuery.isLoading;
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
    <div className={styles.layout}>

      <aside
        className={sidebarClass}
        onClick={activeView === 'map' ? () => setActiveView('list') : undefined}
      >
        <header className={styles.header}>
          <h1 className={styles.title}>Freeway Charge</h1>
          <p className={styles.subtitle}>Charging stations along your route</p>
        </header>

        <RouteInput onSubmit={handleRouteSubmit} isLoading={isLoading} />

        {error && (
          <div className={styles.error}>
            {(error as Error).message}
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
        />

        {/* Thumbnail label — only visible on mobile when this view is inactive */}
        <div className={styles.thumbnailLabel}>Map</div>
      </main>

    </div>
    </APIProvider>
  );
}
