import { useState, useEffect, useRef } from 'react';
import { useMapsLibrary, Map, Marker, useMap } from '@vis.gl/react-google-maps';
import type { PermissionState } from '../../hooks/useGeolocation';
import styles from './DestinationSearch.module.css';

// Fits the minimap to show both the user's current position and the destination.
function MinimapFit({
  userPos,
  destPos,
}: {
  userPos: { lat: number; lng: number } | null;
  destPos: { lat: number; lng: number };
}) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !coreLib) return;
    const bounds = new coreLib.LatLngBounds();
    if (userPos) bounds.extend(userPos);
    bounds.extend(destPos);
    map.fitBounds(bounds, 40);
  }, [map, coreLib, userPos, destPos]);

  return null;
}

interface Props {
  onConfirm: (place: google.maps.places.PlaceResult) => void;
  position: GeolocationCoordinates | null;
  permissionState: PermissionState;
}

export function DestinationSearch({ onConfirm, position, permissionState }: Props) {
  const [value, setValue] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<google.maps.places.PlaceResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const placesLib = useMapsLibrary('places');

  const destLat = selectedPlace?.geometry?.location?.lat();
  const destLng = selectedPlace?.geometry?.location?.lng();
  const destPos = destLat !== undefined && destLng !== undefined
    ? { lat: destLat, lng: destLng }
    : null;
  const userPos = position
    ? { lat: position.latitude, lng: position.longitude }
    : null;

  const isDenied = permissionState === 'denied' || permissionState === 'unsupported';
  const isLocating = !isDenied && !position;

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const ac = new placesLib.Autocomplete(inputRef.current, {
      fields: ['name', 'formatted_address', 'geometry'],
    });

    function selectPlace(place: google.maps.places.PlaceResult) {
      if (place.geometry) {
        setSelectedPlace(place);
        setValue(place.name ?? place.formatted_address ?? '');
      }
    }

    const listener = ac.addListener('place_changed', () => selectPlace(ac.getPlace()));

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__triggerPlaceSelect = selectPlace;
    }
    return () => {
      listener?.remove();
      if (import.meta.env.DEV) {
        delete (window as unknown as Record<string, unknown>).__triggerPlaceSelect;
      }
    };
  }, [placesLib]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value);
    if (selectedPlace) setSelectedPlace(null);
  }

  function handleGoNow() {
    if (!selectedPlace || !position) return;
    onConfirm(selectedPlace);
  }

  const isExpanded = selectedPlace !== null;

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1 className={styles.title}>let's just drive</h1>
          <p className={styles.subtitle}>quality charging ON your route</p>
        </div>

        <div className={styles.inputSection}>
          <input
            id="dest-input"
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="where do we go now?"
            value={value}
            onChange={handleInputChange}
            autoFocus
          />

          {/* Expands below the input when a destination is selected */}
          <div className={`${styles.expandSection} ${isExpanded ? styles.expandOpen : ''}`}>
            <div className={styles.expandInner}>
              {destPos && (
                <div className={styles.minimap}>
                  <Map
                    defaultCenter={destPos}
                    defaultZoom={10}
                    gestureHandling="none"
                    disableDefaultUI={true}
                  >
                    <MinimapFit userPos={userPos} destPos={destPos} />
                    {/* Destination: default Google Maps red pin */}
                    <Marker position={destPos} />
                    {/* User position: blue circle */}
                    {userPos && (
                      <Marker
                        position={userPos}
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
                  </Map>
                </div>
              )}

              <button
                className={styles.goButton}
                onClick={handleGoNow}
                disabled={isLocating || !position}
              >
                {isLocating ? 'Getting your location\u2026' : "let's go"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
