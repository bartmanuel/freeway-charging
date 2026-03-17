import type { StationOnRoute } from '../../types/station';
import styles from './StationList.module.css';

interface Props {
  stations: StationOnRoute[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(0)} km`
    : `${Math.round(meters)} m`;
}

function formatDetour(meters: number): string {
  if (meters < 100) return 'On route';
  return `+${formatDistance(meters)} detour`;
}

function powerLabel(kw: number): string {
  if (kw >= 300) return `${kw} kW`;
  if (kw >= 150) return `${kw} kW`;
  return `${kw} kW`;
}

function powerClass(kw: number): string {
  if (kw >= 250) return styles.powerHigh;
  if (kw >= 150) return styles.powerMid;
  return styles.powerLow;
}

export function StationList({ stations, selectedId, onSelect }: Props) {
  if (stations.length === 0) {
    return <p className={styles.empty}>No charging stations found along this route.</p>;
  }

  return (
    <ul className={styles.list}>
      {stations.map(({ station, distanceAlongRouteMeters, detourMeters }) => (
        <li
          key={station.id}
          className={`${styles.card} ${selectedId === station.id ? styles.selected : ''}`}
          onClick={() => onSelect(station.id)}
        >
          <div className={styles.header}>
            <span className={styles.name}>{station.name}</span>
            <span className={`${styles.power} ${powerClass(station.maxPowerKw)}`}>
              {powerLabel(station.maxPowerKw)}
            </span>
          </div>
          <div className={styles.meta}>
            <span>{station.operator ?? 'Unknown operator'}</span>
            {station.totalStalls != null && (
              <span>{station.totalStalls} stalls</span>
            )}
          </div>
          <div className={styles.distance}>
            <span>{formatDistance(distanceAlongRouteMeters)} along route</span>
            <span className={styles.detour}>{formatDetour(detourMeters)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
