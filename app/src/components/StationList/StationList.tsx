import type { StationOnRoute, StationAvailability, ConnectorAvailability, HistoryPoint } from '../../types/station';
import type { RouteProjection } from '../../utils/routeProjection';
import styles from './StationList.module.css';

interface Props {
  stations: StationOnRoute[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  availabilityMap?: Map<number, StationAvailability>;
  pendingIds?: Set<number>;
  userProjection?: RouteProjection | null;
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

// ─── Spark chart ─────────────────────────────────────────────────────────────

const N_BARS   = 20;   // 20 minutes of history
const BAR_W    = 3;    // px per bar
const BAR_GAP  = 1;    // px between bars
const CHART_W  = N_BARS * BAR_W + (N_BARS - 1) * BAR_GAP; // 79
const CHART_H  = 28;   // px, chart plot area height
const TOP      = 4;    // top margin
const BOTTOM   = TOP + CHART_H;  // y of x-axis = 32
const YAXIS_X  = CHART_W + 4;    // 83 — vertical axis line
const LABEL_X  = CHART_W + 7;    // 86 — y-axis text
const SVG_W    = CHART_W + 22;   // 101
const SVG_H    = BOTTOM + 10;    // 42

function barColor(ratio: number): string {
  if (ratio > 0.75) return '#16a34a'; // green
  if (ratio > 0.50) return '#ca8a04'; // yellow
  if (ratio > 0.25) return '#ea580c'; // orange
  return '#dc2626';                    // red
}

function SparkChart({ history }: { history: HistoryPoint[] }) {
  if (!history.length) return null;

  // Bucket readings into per-minute slots; history is newest-first
  const nowMs = Date.now();
  const slots: (number | null)[] = new Array(N_BARS).fill(null);
  for (const pt of history) {
    const minsAgo = Math.floor((nowMs - new Date(pt.ts).getTime()) / 60_000);
    if (minsAgo < 0 || minsAgo >= N_BARS) continue;
    const idx = (N_BARS - 1) - minsAgo; // idx 19 = "now", idx 0 = "−19 min"
    if (slots[idx] === null && pt.total > 0) {
      slots[idx] = pt.avail / pt.total;
    }
  }

  if (slots.every(s => s === null)) return null;

  return (
    <svg
      width={SVG_W}
      height={SVG_H}
      className={styles.sparkSvg}
      aria-label="Availability — last 20 minutes"
    >
      {/* X-axis */}
      <line x1={0} y1={BOTTOM} x2={CHART_W} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
      {/* Y-axis */}
      <line x1={YAXIS_X} y1={TOP} x2={YAXIS_X} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
      {/* Y-axis ticks */}
      <line x1={YAXIS_X} y1={TOP}    x2={YAXIS_X + 3} y2={TOP}    stroke="#d1d5db" strokeWidth={1} />
      <line x1={YAXIS_X} y1={BOTTOM} x2={YAXIS_X + 3} y2={BOTTOM} stroke="#d1d5db" strokeWidth={1} />
      {/* Y-axis labels */}
      <text x={LABEL_X} y={TOP + 4}    fontSize={7} fill="#9ca3af">100%</text>
      <text x={LABEL_X} y={BOTTOM - 1} fontSize={7} fill="#9ca3af">0%</text>
      {/* X-axis time labels */}
      <text x={0}       y={SVG_H - 1} fontSize={7} fill="#9ca3af" textAnchor="start">−20m</text>
      <text x={CHART_W} y={SVG_H - 1} fontSize={7} fill="#9ca3af" textAnchor="end">now</text>
      {/* Bars */}
      {slots.map((ratio, i) => {
        if (ratio === null) return null;
        const barH = Math.max(Math.round(ratio * CHART_H), 1);
        const barX = i * (BAR_W + BAR_GAP);
        const barY = BOTTOM - barH;
        return (
          <rect
            key={i}
            x={barX}
            y={barY}
            width={BAR_W}
            height={barH}
            fill={barColor(ratio)}
          />
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function formatRemainingDistance(stationAlongM: number, userAlongM: number): string {
  const remainingKm = (stationAlongM - userAlongM) / 1000;
  if (remainingKm < -0.5) return 'Passed';
  if (remainingKm < 1) return `${Math.round(remainingKm * 1000)} m ahead`;
  return `${remainingKm.toFixed(1)} km ahead`;
}

export function StationList({ stations, selectedId, onSelect, availabilityMap, pendingIds, userProjection }: Props) {
  if (stations.length === 0) {
    return <p className={styles.empty}>No charging stations found along this route.</p>;
  }

  return (
    <ul className={styles.list}>
      {stations.map(({ station, distanceAlongRouteMeters, detourMeters }) => {
        const availability = availabilityMap?.get(station.id);
        const isPending = pendingIds?.has(station.id) ?? false;
        const remainingM = userProjection
          ? distanceAlongRouteMeters - userProjection.distanceAlongRouteMeters
          : null;
        const isPassed = remainingM !== null && remainingM < -500;
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
              <div className={styles.availRow}>
                <div className={styles.availBadges}>
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
                <SparkChart history={availability?.history ?? []} />
              </div>
            )}
            <div className={styles.distance}>
              {remainingM !== null ? (
                <span className={isPassed ? styles.passed_label : styles.ahead_label}>
                  {formatRemainingDistance(distanceAlongRouteMeters, userProjection!.distanceAlongRouteMeters)}
                </span>
              ) : (
                <span>{formatDistance(distanceAlongRouteMeters)} along route</span>
              )}
              <span className={styles.detour}>{formatDetour(detourMeters)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
