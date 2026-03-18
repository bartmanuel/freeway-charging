import type { StationOnRoute, StationAvailability, ConnectorAvailability } from '../../types/station';
import styles from './StationList.module.css';

interface Props {
  stations: StationOnRoute[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  availabilityMap?: Map<number, StationAvailability>;
  pendingIds?: Set<number>;
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

function availabilityClass(connector: ConnectorAvailability): string {
  const usable = connector.total - connector.outOfService;
  if (usable === 0) return styles.availNone;
  const ratio = connector.available / usable;
  if (ratio > 0.5) return styles.availGood;
  if (ratio > 0) return styles.availPartial;
  return styles.availFull;
}

export function StationList({ stations, selectedId, onSelect, availabilityMap, pendingIds }: Props) {
  if (stations.length === 0) {
    return <p className={styles.empty}>No charging stations found along this route.</p>;
  }

  return (
    <ul className={styles.list}>
      {stations.map(({ station, distanceAlongRouteMeters, detourMeters }) => {
        const availability = availabilityMap?.get(station.id);
        const isPending = pendingIds?.has(station.id) ?? false;
        return (
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
            {(availability || isPending) && (
              <div className={styles.availability}>
                {isPending && !availability ? (
                  <span className={`${styles.availBadge} ${styles.availPending}`}>
                    CCS2 &nbsp;•••
                  </span>
                ) : availability?.connectors.map(c => (
                  <span
                    key={c.type}
                    className={`${styles.availBadge} ${availabilityClass(c)}`}
                    title={`${c.available} of ${c.total} available`}
                  >
                    {c.available}/{c.total} {c.typeLabel}
                  </span>
                ))}
              </div>
            )}
            <div className={styles.distance}>
              <span>{formatDistance(distanceAlongRouteMeters)} along route</span>
              <span className={styles.detour}>{formatDetour(detourMeters)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
