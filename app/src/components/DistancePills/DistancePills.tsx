import styles from './DistancePills.module.css';

interface Props {
  distanceAlongRouteMeters: number;
  detourMeters: number;
  gapMeters: number;
}

export function DistancePills({ distanceAlongRouteMeters, detourMeters, gapMeters }: Props) {
  const routeKm = Math.round(distanceAlongRouteMeters / 1000);
  const gapKm   = Math.round(gapMeters / 1000);
  const hasDetour = detourMeters >= 100;
  const detourKm  = (detourMeters / 1000).toFixed(1);

  return (
    <div className={styles.row}>
      {/* ① Route distance from start */}
      <span className={styles.segment}>
        <img src="/icons/in-app/car.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.arrow}>›</span>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span>{routeKm} km</span>
      </span>

      <span className={styles.divider}>|</span>

      {/* ② Gap from previous station */}
      <span className={styles.segment}>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span className={styles.arrow}>›</span>
        <img src="/icons/in-app/charger.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span>{gapKm} km</span>
      </span>

      <span className={styles.divider}>|</span>

      {/* ③ Detour */}
      <span className={styles.segment}>
        <img src="/icons/in-app/detour.svg" className={styles.icon} alt="" aria-hidden="true" />
        <span>{hasDetour ? `${detourKm} km` : 'on route'}</span>
      </span>
    </div>
  );
}
