import type { StationOnRoute, StationAvailability, ConnectorAvailability, HistoryPoint, Amenity } from '../../types/station';
import type { RouteProjection } from '../../utils/routeProjection';
import { getListLogoSvg } from '../../utils/operatorIcon';
import { getBrandConfig } from '../../utils/amenityIcon';
import { DistancePills } from '../DistancePills/DistancePills';
import styles from './StationList.module.css';

interface Props {
  stations: StationOnRoute[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  availabilityMap?: Map<string, StationAvailability>;
  pendingIds?: Set<string>;
  userProjection?: RouteProjection | null;
  amenityMap?: Map<string, Amenity[]>;
}

function toTitleCase(s: string): string {
  return s.replace(/(\S+)/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function availabilityClass(connector: ConnectorAvailability): string {
  const usable = connector.total - connector.outOfService;
  if (usable === 0) return styles.availNone;
  const ratio = connector.available / usable;
  if (ratio > 0.5) return styles.availGood;
  if (ratio > 0) return styles.availPartial;
  return styles.availFull;
}

// ─── Spark chart ─────────────────────────────────────────────────────────────

const N_BARS    = 20;   // 20 minutes of history
const BAR_W     = 3;    // px per bar
const BAR_GAP   = 1;    // px between bars
const CHART_W   = N_BARS * BAR_W + (N_BARS - 1) * BAR_GAP; // 79
const CHART_H   = 28;   // px, chart plot area height
const TOP       = 4;    // top margin
const BOTTOM    = TOP + CHART_H;  // y of x-axis = 32
const BAR_SVG_H = BOTTOM + 1;    // 33 — +1 ensures x-axis stroke is fully visible
const AXIS_W    = 26;   // fixed px width for y-axis SVG

// Minimum bar height for a 0% reading — visually distinct from "no data"
const MIN_DATA_H = 2;
// Height of the placeholder grey bar for missing data slots
const NO_DATA_H  = Math.round(CHART_H / 2);

function barColor(ratio: number): string {
  if (ratio > 0.75) return '#16a34a'; // green
  if (ratio > 0.50) return '#ca8a04'; // yellow
  if (ratio > 0.25) return '#ea580c'; // orange
  return '#dc2626';                    // red
}

function SparkChart({ history }: { history: HistoryPoint[] }) {
  if (!history.length) return null;

  const nowMinute = Math.floor(Date.now() / 60_000);
  const slots: (number | null)[] = new Array(N_BARS).fill(null);
  for (const pt of history) {
    const ptMinute = Math.floor(new Date(pt.ts).getTime() / 60_000);
    const minsAgo = nowMinute - ptMinute;
    if (minsAgo < 0 || minsAgo >= N_BARS) continue;
    const idx = (N_BARS - 1) - minsAgo; // idx 19 = "now", idx 0 = "−19 min"
    if (slots[idx] === null && pt.total > 0) {
      slots[idx] = pt.avail / pt.total;
    }
  }

  if (slots.every(s => s === null)) return null;

  return (

    <>
      <div className={styles.sparkInner}>
        {/* Bars — stretches horizontally, preserveAspectRatio="none" for x-scaling only */}
        <svg
          className={styles.sparkBarSvg}
          viewBox={`0 0 ${CHART_W} ${BAR_SVG_H}`}
          preserveAspectRatio="none"
          height={BAR_SVG_H}
          aria-label="Availability — last 20 minutes"
        >
          <line x1={0} y1={BOTTOM} x2={CHART_W} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
          {slots.map((ratio, i) => {
            const barX = i * (BAR_W + BAR_GAP);
            if (ratio === null) {
              return (
                <rect key={i} x={barX} y={BOTTOM - NO_DATA_H} width={BAR_W} height={NO_DATA_H} fill="#d1d5db" opacity={0.4} />
              );
            }
            const barH = ratio === 0 ? MIN_DATA_H : Math.max(Math.round(ratio * CHART_H), MIN_DATA_H);
            return (
              <rect key={i} x={barX} y={BOTTOM - barH} width={BAR_W} height={barH} fill={barColor(ratio)} />
            );
          })}
        </svg>
        {/* Y-axis — fixed width, text not stretched */}
        <svg
          className={styles.sparkAxisSvg}
          viewBox={`0 0 ${AXIS_W} ${BAR_SVG_H}`}
          width={AXIS_W}
          height={BAR_SVG_H}
        >
          <line x1={4} y1={TOP}    x2={4} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
          <line x1={4} y1={TOP}    x2={7} y2={TOP}    stroke="#d1d5db" strokeWidth={1} />
          <line x1={4} y1={BOTTOM} x2={7} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
          <text x={8} y={TOP + 4}    fontSize={7} fill="#9ca3af">100%</text>
          <text x={8} y={BOTTOM - 1} fontSize={7} fill="#9ca3af">0%</text>
        </svg>
      </div>
      {/* Time labels span only the bar area (not under the axis) */}
      <div className={styles.sparkTimes}>
        <span>−20m</span>
        <span>now</span>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AmenityPills({ amenities }: { amenities: Amenity[] }) {
  // De-duplicate brands and show top 5
  const seen = new Set<string>();
  const unique = amenities.filter(a => {
    if (seen.has(a.brand)) return false;
    seen.add(a.brand);
    return true;
  }).slice(0, 5);

  if (unique.length === 0) return null;

  return (
    <div className={styles.amenityRow}>
      {unique.map(a => {
        const cfg = getBrandConfig(a.brand);
        if (!cfg) return null;
        return (
          <span
            key={a.brand}
            className={styles.amenityPill}
            style={{ background: cfg.bg, color: cfg.fg }}
            title={`${cfg.label} (~${a.distance} m)`}
          >
            {cfg.label}
          </span>
        );
      })}
    </div>
  );
}

export function StationList({ stations, selectedId, onSelect, availabilityMap, pendingIds, userProjection, amenityMap }: Props) {
  if (stations.length === 0) {
    return <p className={styles.empty}>No charging stations found along this route.</p>;
  }

  return (
    <ul className={styles.list}>
      {stations.map(({ station, distanceAlongRouteMeters, detourMeters }, index) => {
        const availability = availabilityMap?.get(station.id);
        const isPending = pendingIds?.has(station.id) ?? false;
        const amenities = amenityMap?.get(station.id) ?? [];
        const remainingM = userProjection
          ? distanceAlongRouteMeters - userProjection.distanceAlongRouteMeters
          : null;
        const isPassed = remainingM !== null && remainingM < -500;

        // Gap distance: from previous station (or start) to this station
        const prevDistance = index === 0 ? 0 : stations[index - 1].distanceAlongRouteMeters;
        const gapMeters = distanceAlongRouteMeters - prevDistance;

        return (
          <li
            key={station.id}
            className={[
              styles.card,
              selectedId === station.id ? styles.selected : '',
              isPassed ? styles.passed : '',
            ].join(' ')}
            onClick={() => onSelect(station.id)}
          >
            <div className={styles.header}>
              <span
                className={styles.operatorLogo}
                dangerouslySetInnerHTML={{ __html: getListLogoSvg(station.operator) }}
                title={station.operator ?? 'Unknown operator'}
              />
              <span className={styles.nameRow}>
                <span className={styles.name}>{toTitleCase(station.name)}</span>
                {station.operator && (
                  <span className={styles.nameCpo}>({station.operator})</span>
                )}
              </span>
              <div className={styles.rightCol}>
                <span className={styles.power}>{station.maxPowerKw} kW</span>
                {isPending && !availability ? (
                  <span className={`${styles.availCount} ${styles.availPending}`}>
                    •••/?
                    <img src="/icons/in-app/plug.svg" className={styles.availIcon} alt="" aria-hidden="true" />
                  </span>
                ) : availability ? (
                  availability.connectors.map(c => (
                    <span
                      key={c.type}
                      className={`${styles.availCount} ${availabilityClass(c)}`}
                      title={`${c.available} of ${c.total} available`}
                    >
                      {c.available}/{c.total}
                      <img src="/icons/in-app/plug.svg" className={styles.availIcon} alt="" aria-hidden="true" />
                    </span>
                  ))
                ) : (
                  <span className={styles.availCount}>
                    ?/{station.totalStalls ?? '?'}
                    <img src="/icons/in-app/plug.svg" className={styles.availIcon} alt="" aria-hidden="true" />
                  </span>
                )}
              </div>
            </div>
            <DistancePills
              distanceAlongRouteMeters={distanceAlongRouteMeters}
              detourMeters={detourMeters}
              gapMeters={gapMeters}
            />
            {(availability?.history?.length ?? 0) > 0 && (
              <div className={styles.sparkRow}>
                <SparkChart history={availability!.history} />
              </div>
            )}
            {amenities.length > 0 && <AmenityPills amenities={amenities} />}
          </li>
        );
      })}
    </ul>
  );
}
