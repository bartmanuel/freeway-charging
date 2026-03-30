import styles from './DistancePills.module.css';

interface Props {
  distanceAlongRouteMeters: number;
  detourMeters: number;
  gapMeters: number;
  /** Remaining distance from user's current position (negative = passed). Omit when not tracking. */
  remainingMeters?: number | null;
}

function formatRemaining(meters: number): string {
  if (meters < -500) return 'Passed';
  if (meters < 1000) return `${Math.round(Math.max(meters, 0))} m ahead`;
  return `${(meters / 1000).toFixed(1)} km ahead`;
}

export function DistancePills({ distanceAlongRouteMeters, detourMeters, gapMeters, remainingMeters }: Props) {
  const routeKm = Math.round(distanceAlongRouteMeters / 1000);
  const gapKm   = Math.round(gapMeters / 1000);
  const hasDetour = detourMeters >= 100;
  const detourKm  = (detourMeters / 1000).toFixed(1);
  const isPassed = remainingMeters != null && remainingMeters < -500;

  return (
    <div className={styles.row}>
      {/* ① Distance from current position (when tracking) or from route start */}
      <span className={styles.segment}>
        <img src="/icons/in-app/car.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.arrow}>›</span>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.value} style={isPassed ? { color: '#9ca3af' } : undefined}>
          {remainingMeters != null ? formatRemaining(remainingMeters) : `${routeKm} km`}
        </span>
      </span>

      <span className={styles.divider}>|</span>

      {/* ② Gap from previous station */}
      <span className={styles.segment}>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.arrow}>›</span>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.value}>{gapKm} km</span>
      </span>

      <span className={styles.divider}>|</span>

      {/* ③ Detour */}
      <span className={styles.segment}>
        <img src="/icons/in-app/detour.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.value}>{hasDetour ? `${detourKm} km` : 'on route'}</span>
      </span>
    </div>
  );
}
