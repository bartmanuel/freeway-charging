/**
 * Phase 0 Research: OpenChargeMap station density test
 *
 * Tests two query strategies along the A2 motorway (Amsterdam → Eindhoven, ~110 km):
 *   Strategy A: Single request using OCM's polyline= parameter
 *   Strategy B: Multiple radius queries at ~20 km intervals (reliable fallback)
 *
 * Usage:
 *   node test-ocm-corridor.mjs
 *   OCM_API_KEY=your_key node test-ocm-corridor.mjs
 *
 * Get a free API key at: https://openchargemap.org/site/develop/registerkey
 */

const API_KEY = process.env.OCM_API_KEY || '';
const BASE_URL = 'https://api.openchargemap.io/v3/poi/';

// A2 motorway waypoints roughly every 20 km
// Amsterdam → Abcoude → Utrecht → Vianen → 's-Hertogenbosch → Eindhoven
const A2_WAYPOINTS = [
  { lat: 52.3676, lng: 4.9041, name: 'Amsterdam (start)' },
  { lat: 52.2717, lng: 4.9779, name: 'Abcoude (~20 km)' },
  { lat: 52.0907, lng: 5.1214, name: 'Utrecht (~40 km)' },
  { lat: 51.9875, lng: 5.0992, name: 'Vianen (~55 km)' },
  { lat: 51.8183, lng: 5.2497, name: 'Zaltbommel (~75 km)' },
  { lat: 51.6989, lng: 5.3283, name: 'Boxtel (~90 km)' },
  { lat: 51.4416, lng: 5.4697, name: 'Eindhoven (end)' },
];

// Total route distance in km (for density calculation)
const ROUTE_LENGTH_KM = 110;

// Filters — target: high-power DC rapid chargers
const FILTERS = {
  levelid: 3,           // Level 3 = DC rapid/fast (50 kW+)
  minpowerkilowatts: 50, // Additional kW filter (may be ignored if unsupported)
  maxresults: 500,
  compact: true,
  verbose: false,
};

// ─── Polyline encoding ───────────────────────────────────────────────────────

function encodePolyline(points) {
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const { lat, lng } of points) {
    const encodedLat = encodeValue(Math.round(lat * 1e5) - prevLat);
    const encodedLng = encodeValue(Math.round(lng * 1e5) - prevLng);
    prevLat = Math.round(lat * 1e5);
    prevLng = Math.round(lng * 1e5);
    output += encodedLat + encodedLng;
  }
  return output;
}

function encodeValue(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  output += String.fromCharCode(v + 63);
  return output;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function queryOCM(params) {
  const url = new URL(BASE_URL);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (API_KEY) url.searchParams.set('key', API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OCM API error: ${res.status} ${res.statusText}`);
  return res.json();
}

function dedupeById(stations) {
  const seen = new Set();
  return stations.filter(s => {
    if (seen.has(s.ID)) return false;
    seen.add(s.ID);
    return true;
  });
}

function formatStation(s) {
  const name = s.AddressInfo?.Title ?? 'Unknown';
  const operator = s.OperatorInfo?.Title ?? 'Unknown operator';
  const maxKw = s.Connections
    ?.map(c => c.PowerKW)
    .filter(Boolean)
    .reduce((a, b) => Math.max(a, b), 0) ?? '?';
  const stalls = s.NumberOfPoints ?? '?';
  const lat = s.AddressInfo?.Latitude?.toFixed(4);
  const lng = s.AddressInfo?.Longitude?.toFixed(4);
  return `  • ${name} | ${operator} | ${maxKw} kW max | ${stalls} stalls | (${lat}, ${lng})`;
}

// ─── Strategy A: Polyline parameter ──────────────────────────────────────────

async function strategyA_polyline() {
  console.log('\n━━━ Strategy A: OCM polyline= parameter ━━━');
  const polyline = encodePolyline(A2_WAYPOINTS);
  console.log(`Encoded polyline (${polyline.length} chars): ${polyline.slice(0, 40)}…`);

  try {
    const stations = await queryOCM({
      polyline,
      distance: 3,           // 3 km corridor either side
      distanceunit: 'KM',
      ...FILTERS,
    });

    const unique = dedupeById(stations);
    console.log(`\nResult: ${unique.length} unique stations within 3 km of A2\n`);
    unique.forEach(s => console.log(formatStation(s)));
    return unique;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    return null;
  }
}

// ─── Strategy B: Multiple radius queries ─────────────────────────────────────

async function strategyB_multiRadius() {
  console.log('\n━━━ Strategy B: Multiple radius queries (20 km intervals) ━━━');
  const allStations = [];

  for (const wp of A2_WAYPOINTS) {
    process.stdout.write(`  Querying ${wp.name}… `);
    try {
      const stations = await queryOCM({
        latitude: wp.lat,
        longitude: wp.lng,
        distance: 15,        // 15 km radius catches ~20 km gap overlap
        distanceunit: 'KM',
        ...FILTERS,
      });
      process.stdout.write(`${stations.length} stations\n`);
      allStations.push(...stations);
      await new Promise(r => setTimeout(r, 300)); // be polite to the API
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message}\n`);
    }
  }

  const unique = dedupeById(allStations);
  console.log(`\nResult: ${unique.length} unique stations after dedup\n`);
  unique.forEach(s => console.log(formatStation(s)));
  return unique;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('OpenChargeMap Corridor Density Test');
  console.log(`Route: Amsterdam → Eindhoven (A2, ~${ROUTE_LENGTH_KM} km)`);
  console.log(`Filter: Level 3 DC rapid, ≥${FILTERS.minpowerkilowatts} kW`);
  console.log(`API key: ${API_KEY ? 'provided ✓' : 'not set (rate-limited)'}`);

  const resultA = await strategyA_polyline();
  const resultB = await strategyB_multiRadius();

  console.log('\n━━━ Summary ━━━');

  if (resultA !== null) {
    const densityA = (resultA.length / ROUTE_LENGTH_KM * 100).toFixed(1);
    console.log(`Strategy A (polyline):       ${resultA.length} stations → ${densityA} per 100 km`);
  } else {
    console.log('Strategy A (polyline):       FAILED (parameter not supported)');
  }

  if (resultB !== null) {
    const densityB = (resultB.length / ROUTE_LENGTH_KM * 100).toFixed(1);
    console.log(`Strategy B (radius queries): ${resultB.length} stations → ${densityB} per 100 km`);
  }

  console.log(`\nTarget from dev plan: ≥3–4 stations per 100 km`);

  if (resultB !== null) {
    const density = resultB.length / ROUTE_LENGTH_KM * 100;
    if (density >= 3) {
      console.log('✓ Station density is sufficient for MVP');
    } else {
      console.log('✗ Station density is LOW — consider relaxing filters (lower kW threshold, include Level 2)');
    }
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
