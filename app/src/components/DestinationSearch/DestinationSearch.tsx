import { useState, useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import styles from './DestinationSearch.module.css';

interface Props {
  onPlaceSelected: (place: google.maps.places.PlaceResult) => void;
}

export function DestinationSearch({ onPlaceSelected }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const placesLib = useMapsLibrary('places');

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

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1 className={styles.title}>Freeway Charge</h1>
          <p className={styles.subtitle}>Charging stations along your route</p>
        </div>
        <label className={styles.label} htmlFor="dest-input">
          Where do we go now?
        </label>
        <input
          id="dest-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Enter destination"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
        />
      </div>
    </div>
  );
}
