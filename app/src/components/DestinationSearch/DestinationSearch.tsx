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
    // Expose test hook so Playwright smoke tests can bypass the autocomplete dropdown.
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__triggerPlaceSelect = onPlaceSelected;
    }
    return () => {
      listener?.remove();
      if (import.meta.env.DEV) {
        delete (window as unknown as Record<string, unknown>).__triggerPlaceSelect;
      }
    };
  }, [placesLib, onPlaceSelected]);

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <h1 className={styles.title}>let's just drive</h1>
          <p className={styles.subtitle}>quality charging ON your route</p>
        </div>

        <input
          id="dest-input"
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder="Where do we go now?"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
        />
      </div>
    </div>
  );
}
