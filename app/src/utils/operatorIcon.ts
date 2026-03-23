/**
 * Brand icons for EV charging operators.
 *
 * Two formats are produced per operator:
 *  - markerDataUri  — SVG data URI for use as a Google Maps Marker icon (36×44 px map pin).
 *  - listLogoSvg    — Inline SVG string for the 22×22 badge in the station list.
 */

interface OperatorConfig {
  bgColor: string;
  strokeColor: string;
  textColor: string;
  /** Short symbol shown inside the 22×22 list badge */
  badgeSymbol: string;
  /** Inner SVG markup drawn inside the 36×44 pin circle */
  pinInner: string;
}

// ── Brand configurations ───────────────────────────────────────────────────────

const CONFIGS: Record<string, OperatorConfig> = {
  fastned: {
    bgColor: '#F5A200',
    strokeColor: '#1a1a1a',
    textColor: '#1a1a1a',
    badgeSymbol: '⚡',
    pinInner: `<path d="M21 8 L14 20 H19 L15 32 L23 18 H18 Z" fill="#1a1a1a"/>`,
  },
  ionity: {
    bgColor: '#1A1423',
    strokeColor: '#7B2ABB',
    textColor: '#ffffff',
    badgeSymbol: 'I',
    pinInner: `
      <rect x="15.5" y="8" width="5" height="2.5" rx="1.2" fill="#fff"/>
      <rect x="17.5" y="11" width="1.5" height="10" fill="#fff"/>
      <rect x="15.5" y="21" width="5" height="2.5" rx="1.2" fill="#fff"/>`,
  },
  shell: {
    bgColor: '#FFC429',
    strokeColor: '#DD1D21',
    textColor: '#DD1D21',
    badgeSymbol: 'S',
    // Simplified Shell pecten (scallop) shape
    pinInner: `
      <path d="M18 8
        C13 8 8.5 12 9 17
        L12.5 14.5 L14 19 L16.5 15.5 L18 20.5 L19.5 15.5 L22 19 L23.5 14.5 L27 17
        C27.5 12 23 8 18 8Z"
        fill="#DD1D21"/>
      <ellipse cx="18" cy="21.5" rx="3" ry="1.8" fill="#DD1D21"/>`,
  },
  tesla: {
    bgColor: '#1a1a1a',
    strokeColor: '#E82127',
    textColor: '#E82127',
    badgeSymbol: 'T',
    // Simplified Tesla "T" logo
    pinInner: `
      <rect x="11" y="9" width="14" height="2.5" rx="1" fill="#E82127"/>
      <rect x="16.5" y="11.5" width="3" height="13" rx="1" fill="#E82127"/>
      <path d="M13 9 Q15 12.5 16.5 11.5" fill="none" stroke="#E82127" stroke-width="1"/>
      <path d="M23 9 Q21 12.5 19.5 11.5" fill="none" stroke="#E82127" stroke-width="1"/>`,
  },
};

const DEFAULT_CONFIG: OperatorConfig = {
  bgColor: '#2563eb',
  strokeColor: '#1d4ed8',
  textColor: '#ffffff',
  badgeSymbol: '⚡',
  pinInner: `
    <text x="18" y="23" text-anchor="middle"
      font-family="Arial,sans-serif" font-size="15" font-weight="bold" fill="#fff">⚡</text>`,
};

// ── Lookup helpers ────────────────────────────────────────────────────────────

function getConfig(operator: string | null): OperatorConfig {
  const key = (operator ?? '').toLowerCase().replace(/\s+/g, '');
  if (key.startsWith('fastned'))      return CONFIGS.fastned;
  if (key.startsWith('ionity'))       return CONFIGS.ionity;
  if (key.startsWith('shell'))        return CONFIGS.shell;
  if (key.startsWith('tesla'))        return CONFIGS.tesla;
  return DEFAULT_CONFIG;
}

// ── Map marker data URI ───────────────────────────────────────────────────────

function buildPinSvg(cfg: OperatorConfig): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
  <path d="M18 2C9.2 2 2 9.2 2 18C2 30 18 44 18 44C18 44 34 30 34 18C34 9.2 26.8 2 18 2Z"
    fill="${cfg.bgColor}" stroke="${cfg.strokeColor}" stroke-width="1.5"/>
  ${cfg.pinInner}
</svg>`;
}

/** Returns a Google Maps `icon` config object for the given operator. */
export function getMarkerIcon(operator: string | null): google.maps.Icon {
  const cfg = getConfig(operator);
  const svg = buildPinSvg(cfg);
  return {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(36, 44),
    anchor: new google.maps.Point(18, 44),
  };
}

// ── List-view logo SVG ────────────────────────────────────────────────────────

/** Returns an SVG string for a 22×22 circular operator badge. */
export function getListLogoSvg(operator: string | null): string {
  const cfg = getConfig(operator);
  const isEmoji = cfg.badgeSymbol === '⚡';
  const textProps = isEmoji
    ? `font-size="13" dy="0.3em"`
    : `font-size="12" font-weight="700" dy="0.35em"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="10" fill="${cfg.bgColor}" stroke="${cfg.strokeColor}" stroke-width="1.5"/>
  <text x="11" y="11" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial,sans-serif" fill="${cfg.textColor}" ${textProps}>${cfg.badgeSymbol}</text>
</svg>`;
}
