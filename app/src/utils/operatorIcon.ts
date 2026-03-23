/**
 * Real brand logos and map markers for EV charging operators.
 *
 * Logo SVG paths sourced from:
 *  - Fastned: Wikimedia Commons (File:Fastned_logo_2025.svg)
 *  - IONITY:  Wikimedia Commons (File:Ionity_logo_cmyk.svg)
 *  - Shell:   Simple Icons (simpleicons.org/icons/shell.svg) — Shell pecten
 *  - Tesla:   Simple Icons (simpleicons.org/icons/tesla.svg)
 */

// ── Map marker (small dot, same visual weight as Google's standard dots) ──────
//
// 22×22 px circle with brand colour; no tall teardrop pin shape.
// The anchor is the centre-bottom of the circle.

function buildDotSvg(bg: string, stroke: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="10" fill="${bg}" stroke="${stroke}" stroke-width="1.5"/>
</svg>`;
}

/** Returns a Google Maps `icon` config for a small branded dot. */
export function getMarkerIcon(operator: string | null): google.maps.Icon {
  const { dotBg, dotStroke } = getMarkerColors(operator);
  const svg = buildDotSvg(dotBg, dotStroke);
  return {
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(22, 22),
    anchor: new google.maps.Point(11, 11),
  };
}

function getMarkerColors(operator: string | null): { dotBg: string; dotStroke: string } {
  const key = normalise(operator);
  if (key.startsWith('fastned'))  return { dotBg: '#FFD913', dotStroke: '#421700' };
  if (key.startsWith('ionity'))   return { dotBg: '#7B0DBF', dotStroke: '#13007C' };
  if (key.startsWith('shell'))    return { dotBg: '#FFC000', dotStroke: '#E31836' };
  if (key.startsWith('tesla'))    return { dotBg: '#E82127', dotStroke: '#1a1a1a' };
  return { dotBg: '#2563eb', dotStroke: '#1d4ed8' };
}

function normalise(op: string | null): string {
  return (op ?? '').toLowerCase().replace(/\s+/g, '');
}

// ── List-view logo (real brand marks) ─────────────────────────────────────────
//
// Each badge is a 28×28 SVG showing the operator's recognisable brand mark.

/** Returns an SVG string for a 28×28 operator logo badge for the station list. */
export function getListLogoSvg(operator: string | null): string {
  const key = normalise(operator);
  if (key.startsWith('fastned'))  return FASTNED_BADGE;
  if (key.startsWith('ionity'))   return IONITY_BADGE;
  if (key.startsWith('shell'))    return SHELL_BADGE;
  if (key.startsWith('tesla'))    return TESLA_BADGE;
  return GENERIC_BADGE;
}

// ── Fastned ───────────────────────────────────────────────────────────────────
// Brand: yellow (#FFD913) bowtie/chevron mark on dark brown/black background.
// Path extracted from the yellow element of the official 2025 Fastned SVG logo.
// Original viewBox "0 0 213 28"; the mark occupies roughly x 0–71.
const FASTNED_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 71 28">
  <rect width="71" height="28" rx="5" fill="#1a1200"/>
  <path fill="#FFD913" d="M35.294 14.745 2.056.28a.99.99 0 0 0-1.39.905v6.933a8.923 8.923 0 0 0 5.555 8.256L32.3 27.038a8.99 8.99 0 0 0 6.784 0l26.081-10.663a8.923 8.923 0 0 0 5.555-8.256V1.186a.99.99 0 0 0-1.39-.905L36.091 14.745c-.25.109-.54.109-.798 0z"/>
</svg>`;

// ── IONITY ────────────────────────────────────────────────────────────────────
// Brand: circular ring (the "O") with purple-to-red gradient.
// Simplified from the official IONITY SVG (Wikimedia Commons Ionity_logo_cmyk.svg).
// Original uses a complex absolute-coordinate path; re-expressed as two circles.
const IONITY_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <defs>
    <linearGradient id="ig" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#13007C"/>
      <stop offset="45%"  stop-color="#55017D"/>
      <stop offset="63%"  stop-color="#90015C"/>
      <stop offset="88%"  stop-color="#DD0031"/>
      <stop offset="100%" stop-color="#FB0020"/>
    </linearGradient>
  </defs>
  <!-- Outer ring filled with gradient, inner circle punched out via mask -->
  <circle cx="14" cy="14" r="13" fill="url(#ig)"/>
  <circle cx="14" cy="14" r="7.5" fill="#fff"/>
  <!-- White inner fill represents the open centre of the IONITY O mark -->
</svg>`;

// ── Shell ─────────────────────────────────────────────────────────────────────
// Brand: Shell pecten (scallop shell) in yellow (#FFC000) with red (#E31836).
// Path from Simple Icons (simpleicons.org) — viewBox "0 0 24 24".
const SHELL_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#FFC000"/>
  <path fill="#E31836" d="M12 .863C5.34.863 0 6.251 0 12.98c0 .996.038 1.374.246 2.33l3.662 2.71.57 4.515h6.102l.326.227c.377.262.705.375 1.082.375.352 0 .732-.101 1.024-.313l.39-.289h6.094l.563-4.515 3.695-2.71c.208-.956.246-1.334.246-2.33C24 6.252 18.661.863 12 .863zm.996 2.258c.9 0 1.778.224 2.512.649l-2.465 12.548 3.42-12.062c1.059.36 1.863.941 2.508 1.814l.025.034-4.902 10.615 5.572-9.713.033.03c.758.708 1.247 1.567 1.492 2.648l-6.195 7.666 6.436-6.5.01.021c.253.563.417 1.36.417 1.996 0 .509-.024.712-.164 1.25l-3.554 2.602-.467 3.71h-4.475l-.517.395c-.199.158-.482.266-.682.266-.199 0-.483-.108-.682-.266l-.517-.394H6.322l-.445-3.61-3.627-2.666c-.11-.436-.16-.83-.16-1.261 0-.72.159-1.49.426-2.053l.013-.024 6.45 6.551L2.75 9.621c.25-1.063.874-2.09 1.64-2.713l5.542 9.776L4.979 6.1c.555-.814 1.45-1.455 2.546-1.827l3.424 12.069L8.355 3.816l.055-.03c.814-.45 1.598-.657 2.457-.657.195 0 .286.004.528.03l.587 13.05.46-13.059c.224-.025.309-.029.554-.029z"/>
</svg>`;

// ── Tesla ─────────────────────────────────────────────────────────────────────
// Brand: Tesla "T" mark in red (#E82127) on black.
// Path from Simple Icons (simpleicons.org) — viewBox "0 0 24 24".
const TESLA_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="12" fill="#1a1a1a"/>
  <path fill="#E82127" d="M12 5.362l2.475-3.026s4.245.09 8.471 2.054c-1.082 1.636-3.231 2.438-3.231 2.438-.146-1.439-1.154-1.79-4.354-1.79L12 24 8.619 5.034c-3.18 0-4.188.354-4.335 1.792 0 0-2.146-.795-3.229-2.43C5.28 2.431 9.525 2.34 9.525 2.34L12 5.362l-.004.002H12v-.002zm0-3.899c3.415-.03 7.326.528 11.328 2.28.535-.968.672-1.395.672-1.395C19.625.612 15.528.015 12 0 8.472.015 4.375.61 0 2.349c0 0 .195.525.672 1.396C4.674 1.989 8.585 1.435 12 1.46v.003z"/>
</svg>`;

// ── Generic fallback ──────────────────────────────────────────────────────────
const GENERIC_BADGE = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="13" fill="#2563eb" stroke="#1d4ed8" stroke-width="1.5"/>
  <text x="14" y="14" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial,sans-serif" font-size="16" fill="#fff">⚡</text>
</svg>`;
