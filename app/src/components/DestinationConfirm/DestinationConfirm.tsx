import { Map, Marker } from '@vis.gl/react-google-maps';
import styles from './DestinationConfirm.module.css';
import type { PermissionState } from '../../hooks/useGeolocation';

interface Props {
  place: google.maps.places.PlaceResult;
  position: GeolocationCoordinates | null;
  permissionState: PermissionState;
  onConfirm: () => void;
  onBack: () => void;
}

export function DestinationConfirm({ place, position, permissionState, onConfirm, onBack }: Props) {
  const lat = place.geometry?.location?.lat();
  const lng = place.geometry?.location?.lng();
  const hasMap = lat !== undefined && lng !== undefined;

  const isDenied = permissionState === 'denied' || permissionState === 'unsupported';
  const isLocating = !isDenied && !position;

  return (
    <div className={styles.screen}>
      {hasMap && (
        <div className={styles.mapPreview}>
          <Map
            defaultCenter={{ lat, lng }}
            defaultZoom={14}
            gestureHandling="none"
            disableDefaultUI={true}
          >
            <Marker position={{ lat, lng }} />
          </Map>
        </div>
      )}
      <button className={styles.back} onClick={onBack}>&#8592; Back</button>
      <div className={styles.infoCard}>
        <h2 className={styles.placeName}>{place.name ?? place.formatted_address}</h2>
        {place.name && place.formatted_address && place.formatted_address !== place.name && (
          <p className={styles.address}>{place.formatted_address}</p>
        )}
        {isDenied ? (
          <p className={styles.locationError}>
            Location permission is required to use Freeway Charge.
          </p>
        ) : (
          <button
            className={styles.goButton}
            onClick={onConfirm}
            disabled={isLocating}
          >
            {isLocating ? 'Getting your location\u2026' : 'Go now'}
          </button>
        )}
      </div>
    </div>
  );
}
