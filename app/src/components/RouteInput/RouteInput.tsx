import { useState, useEffect, useRef } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import styles from './RouteInput.module.css';

interface Props {
  onSubmit: (origin: string, destination: string) => void;
  isLoading: boolean;
}

function AutocompleteInput({
  placeholder,
  value,
  onChange,
  disabled,
  placesLib,
}: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  placesLib: google.maps.PlacesLibrary | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!placesLib || !inputRef.current) return;
    const ac = new placesLib.Autocomplete(inputRef.current, {
      fields: ['formatted_address'],
    });
    const listener = ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      onChange(place.formatted_address ?? inputRef.current?.value ?? '');
    });
    return () => listener.remove();
  }, [placesLib, onChange]);

  return (
    <input
      ref={inputRef}
      className={styles.input}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

export function RouteInput({ onSubmit, isLoading }: Props) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const placesLib = useMapsLibrary('places');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (origin.trim() && destination.trim()) {
      onSubmit(origin.trim(), destination.trim());
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <AutocompleteInput
        placeholder="Origin"
        value={origin}
        onChange={setOrigin}
        disabled={isLoading}
        placesLib={placesLib}
      />
      <AutocompleteInput
        placeholder="Destination"
        value={destination}
        onChange={setDestination}
        disabled={isLoading}
        placesLib={placesLib}
      />
      <button
        className={styles.button}
        type="submit"
        disabled={isLoading || !origin || !destination}
      >
        {isLoading ? 'Finding route...' : 'Find charging stations'}
      </button>
    </form>
  );
}
