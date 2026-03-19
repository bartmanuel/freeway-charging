import { useState, useEffect, useRef } from 'react';

export type PermissionState = 'unsupported' | 'prompt' | 'granted' | 'denied';

export interface GeolocationState {
  position: GeolocationCoordinates | null;
  permissionState: PermissionState;
  error: GeolocationPositionError | null;
}

/**
 * Watches the device's GPS position. Only starts the watcher when `enabled`
 * is true (i.e. a route is loaded and the user clicked "Track my position").
 * Cleans up the watcher on unmount or when `enabled` becomes false.
 */
export function useGeolocation(enabled: boolean): GeolocationState {
  const [position, setPosition] = useState<GeolocationCoordinates | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>('prompt');
  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    if (!navigator.geolocation) {
      setPermissionState('unsupported');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition(pos.coords);
        setPermissionState('granted');
        setError(null);
      },
      (err) => {
        setError(err);
        if (err.code === err.PERMISSION_DENIED) {
          setPermissionState('denied');
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled]);

  // Reset state when disabled (e.g. new route searched)
  useEffect(() => {
    if (!enabled) {
      setPosition(null);
      setError(null);
    }
  }, [enabled]);

  return { position, permissionState, error };
}
