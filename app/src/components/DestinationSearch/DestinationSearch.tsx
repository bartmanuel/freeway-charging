import { useState, useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import styles from './DestinationSearch.module.css';

type LocationStatus = 'checking' | 'prompt' | 'granted' | 'denied' | 'unsupported';

function useLocationPermission(): LocationStatus {
  const [status, setStatus] = useState<LocationStatus>('checking');

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unsupported');
      return;
    }

    function requestPosition() {
      navigator.geolocation.getCurrentPosition(
        () => setStatus('granted'),
        (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'granted'),
        { timeout: 10_000, maximumAge: 60_000 },
      );
    }

    if (!navigator.permissions) {
      // Permissions API unavailable — trigger the dialog directly
      requestPosition();
      return;
    }

    navigator.permissions.query({ name: 'geolocation' }).then(result => {
      setStatus(result.state as LocationStatus);
      if (result.state === 'prompt') requestPosition();
      result.addEventListener('change', () => setStatus(result.state as LocationStatus));
    });
  }, []);

  return status;
}

interface Props {
  onPlaceSelected: (place: google.maps.places.PlaceResult) => void;
}

export function DestinationSearch({ onPlaceSelected }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const placesLib = useMapsLibrary('places');
  const locationStatus = useLocationPermission();

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const ac = new placesLib.Autocomplete(inputRef.current, {
      fields: ['name', 'formatted_address', 'geometry'],
    });
    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place.geometry) onPlaceSelected(place);
    });
    return () => listener.remove();
  }, [placesLib, onPlaceSelected]);

  const isDenied = locationStatus === 'denied' || locationStatus === 'unsupported';

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1 className={styles.title}>let's just drive</h1>
          <p className={styles.subtitle}>quality charging ON your route</p>
        </div>

        {isDenied && (
          <div className={styles.locationWarning}>
            <span className={styles.locationWarningIcon}>&#9888;</span>
            <div>
              <strong>Location access required</strong>
              <p>
                {locationStatus === 'unsupported'
                  ? 'Your browser does not support location services.'
                  : 'Please allow location access in your browser settings, then reload the page.'}
              </p>
            </div>
          </div>
        )}

        {locationStatus === 'prompt' && (
          <div className={styles.locationPrompt}>
            Waiting for location permission…
          </div>
        )}

        <input
          id="dest-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Where do we go now?"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
          disabled={isDenied}
        />
      </div>
    </div>
  );
}
