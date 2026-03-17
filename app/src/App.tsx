import { useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { RouteInput } from './components/RouteInput/RouteInput';
import { StationList } from './components/StationList/StationList';
import { MapView } from './components/MapView/MapView';
import { useRoute } from './hooks/useRoute';
import { useStations } from './hooks/useStations';
import styles from './App.module.css';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;

export function App() {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedStationId, setSelectedStationId] = useState<number | null>(null);

  const routeQuery = useRoute(origin, destination);
  const stationsQuery = useStations(routeQuery.data?.id, routeQuery.data?.decodedPath ?? [], routeQuery.data?.distanceMeters ?? 0);

  function handleRouteSubmit(newOrigin: string, newDestination: string) {
    setSelectedStationId(null);
    setOrigin(newOrigin);
    setDestination(newDestination);
  }

  const isLoading = routeQuery.isLoading || stationsQuery.isLoading;
  const error = routeQuery.error || stationsQuery.error;

  return (
    <APIProvider apiKey={GOOGLE_API_KEY}>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
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
          <StationList
            stations={stationsQuery.data}
            selectedId={selectedStationId}
            onSelect={setSelectedStationId}
          />
        )}
      </aside>

      <main className={styles.mapArea}>
        <MapView
          route={routeQuery.data ?? null}
          stations={stationsQuery.data ?? []}
          selectedStationId={selectedStationId}
          onStationSelect={setSelectedStationId}
        />
      </main>
    </div>
    </APIProvider>
  );
}
