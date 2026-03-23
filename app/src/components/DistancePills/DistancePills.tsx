import styles from './DistancePills.module.css';

interface Props {
  distanceAlongRouteMeters: number;
  detourMeters: number;
  gapMeters: number;
}

function gapPillClass(meters: number): string {
  if (meters > 120_000) return styles.gapRed;
  if (meters > 60_000) return styles.gapYellow;
  return styles.gapGreen;
}

export function DistancePills({ distanceAlongRouteMeters, detourMeters, gapMeters }: Props) {
  const routeKm = Math.round(distanceAlongRouteMeters / 1000);
  const gapKm   = Math.round(gapMeters / 1000);
  const hasDetour = detourMeters >= 100;
  const detourKm  = (detourMeters / 1000).toFixed(1);

  return (
    <div className={styles.row}>
      {/* ① Route distance from start — blue, left */}
      <span className={`${styles.pill} ${styles.route}`}>
        🚗&thinsp;{routeKm}&thinsp;km&thinsp;⚡
      </span>

      {/* ② Gap from previous station — traffic-light, centre */}
      <span className={`${styles.pill} ${styles.gap} ${gapPillClass(gapMeters)}`}>
        ⚡&thinsp;{gapKm}&thinsp;km&thinsp;⚡
      </span>

      {/* ③ Detour — orange or green, right */}
      {hasDetour ? (
        <span className={`${styles.pill} ${styles.detour}`}>
          ⤷&thinsp;{detourKm}&thinsp;km
        </span>
      ) : (
        <span className={`${styles.pill} ${styles.noDetour}`}>
          No detour
        </span>
      )}
    </div>
  );
}
