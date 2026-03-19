import { Env } from './types';

const SEARCH_BASE = 'https://api.tomtom.com/search/2';

// Only CCS2 is surfaced to the user
const TARGET_CONNECTOR = 'IEC62196Type2CCS';

const DC_CONNECTOR_TYPES = new Set([
  'IEC62196Type2CCS',
  'IEC62196Type1CCS',
  'Chademo',
  'Tesla',
]);

// ─── TomTom response types ────────────────────────────────────────────────────

interface TomTomConnectorSpec {
  connectorType: string;
  ratedPowerKW: number;
}

interface TomTomNearbyResult {
  poi?: {
    name: string;
    brands?: { name: string }[];
  };
  position: { lat: number; lon: number };
  chargingPark?: { connectors: TomTomConnectorSpec[] };
  dataSources?: { chargingAvailability?: { id: string } };
}

interface TomTomNearbyResponse {
  results: TomTomNearbyResult[];
}

interface TomTomAvailabilityConnector {
  type: string;
  total: number;
  availability: {
    current: {
      available: number;
      occupied: number;
      reserved: number;
      unknown: number;
      outOfService: number;
    };
  };
}

interface TomTomAvailabilityResponse {
  connectors: TomTomAvailabilityConnector[];
}

// ─── Matching helpers ─────────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(bv|gmbh|ag|sa|nv|ltd|inc|sas|srl|oy|ab)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesSimilar(a: string, b: string): boolean {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

function tomtomHasDcConnector(result: TomTomNearbyResult): boolean {
  return (result.chargingPark?.connectors ?? []).some(c => DC_CONNECTOR_TYPES.has(c.connectorType));
}

function ocmHasCcs(connectors: { type: string }[]): boolean {
  return connectors.some(c => c.type.toLowerCase().includes('ccs'));
}

type Confidence = 'high' | 'medium' | 'none';

function matchConfidence(
  ocmName: string,
  ocmOperator: string | null,
  ocmConnectors: { type: string }[],
  result: TomTomNearbyResult,
  distanceMeters: number,
): Confidence {
  if (distanceMeters > 100) return 'none';

  const brandName = result.poi?.brands?.[0]?.name ?? result.poi?.name ?? '';
  const compareTarget = ocmOperator ?? ocmName;
  const brandMatch = brandName.length > 0 && namesSimilar(brandName, compareTarget);

  const hasDc = tomtomHasDcConnector(result);
  const ocmCcs = ocmHasCcs(ocmConnectors);
  // If OCM has no typed CCS connector, don't use it to rule out a match
  const connectorOverlap = !ocmCcs || hasDc;

  if (distanceMeters <= 50 && brandMatch && connectorOverlap) return 'high';
  if (distanceMeters <= 100 && (brandMatch || connectorOverlap)) return 'medium';
  return 'none';
}

// ─── Supabase ID map helpers ──────────────────────────────────────────────────

interface IdMapRow {
  tomtom_avail_id: string;
  confidence: string;
}

async function getStoredTomTomId(env: Env, ocmId: string): Promise<IdMapRow | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/station_tomtom_map?ocm_id=eq.${encodeURIComponent(ocmId)}&select=tomtom_avail_id,confidence&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json() as IdMapRow[];
  return rows[0] ?? null;
}

async function storeTomTomId(env: Env, ocmId: string, tomtomAvailId: string, confidence: string): Promise<void> {
  await fetch(`${env.SUPABASE_URL}/rest/v1/station_tomtom_map`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ ocm_id: ocmId, tomtom_avail_id: tomtomAvailId, confidence }),
  });
}

async function deleteTomTomMapping(env: Env, ocmId: string): Promise<void> {
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/station_tomtom_map?ocm_id=eq.${encodeURIComponent(ocmId)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface StationInput {
  id: string;
  lat: number;
  lng: number;
  name: string;
  operator: string | null;
  connectors: { type: string; powerKw: number | null }[];
  totalStalls?: number | null;
}

export interface ConnectorAvailability {
  type: string;
  typeLabel: string;
  total: number;
  available: number;
  occupied: number;
  outOfService: number;
  unknown: number;
}

/**
 * Returns TomTom availability for a single station.
 * Uses Supabase to cache the OCM→TomTom ID mapping so nearbySearch
 * is only called once per station.
 * Returns null if no confident match is found or TomTom has no data.
 */
export async function fetchStationAvailability(
  env: Env,
  station: StationInput,
): Promise<ConnectorAvailability[] | null> {
  // 1 — Check stored ID mapping
  let tomtomAvailId: string | null = null;

  const stored = await getStoredTomTomId(env, station.id);
  if (stored) {
    tomtomAvailId = stored.tomtom_avail_id;
  } else {
    // 2 — nearbySearch to find TomTom ID
    const params = new URLSearchParams({
      key: env.TOMTOM_API_KEY,
      lat: String(station.lat),
      lon: String(station.lng),
      radius: '150',
      categorySet: '7309',
      connectorSet: 'IEC62196Type2CCS',
      minPowerKW: '50',
      limit: '5',
    });

    let nearbyData: TomTomNearbyResponse;
    try {
      const res = await fetch(`${SEARCH_BASE}/nearbySearch/.json?${params}`);
      if (!res.ok) return null;
      nearbyData = await res.json() as TomTomNearbyResponse;
    } catch {
      return null;
    }

    if (!nearbyData.results?.length) return null;

    // Pick best match
    let bestResult: TomTomNearbyResult | null = null;
    let bestConfidence: Confidence = 'none';
    let bestDistance = Infinity;

    for (const result of nearbyData.results) {
      const dist = haversineMeters(station.lat, station.lng, result.position.lat, result.position.lon);
      const confidence = matchConfidence(station.name, station.operator, station.connectors, result, dist);
      if (confidence === 'none') continue;
      if (
        confidence === 'high' && bestConfidence !== 'high' ||
        confidence === bestConfidence && dist < bestDistance ||
        confidence === 'medium' && bestConfidence === 'none'
      ) {
        bestResult = result;
        bestConfidence = confidence;
        bestDistance = dist;
      }
    }

    if (!bestResult || bestConfidence === 'none') return null;

    const availId = bestResult.dataSources?.chargingAvailability?.id;
    if (!availId) return null;

    tomtomAvailId = availId;

    // Store mapping — use waitUntil so the write survives past the response being sent
    const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;
    ctx.waitUntil(storeTomTomId(env, station.id, availId, bestConfidence).catch(() => {}));
  }

  // 3 — Fetch availability
  const availParams = new URLSearchParams({
    key: env.TOMTOM_API_KEY,
    chargingAvailability: tomtomAvailId,
  });

  let availData: TomTomAvailabilityResponse;
  try {
    const res = await fetch(`${SEARCH_BASE}/chargingAvailability.json?${availParams}`);
    if (!res.ok) return null;
    availData = await res.json() as TomTomAvailabilityResponse;
  } catch {
    return null;
  }

  if (!availData.connectors?.length) return null;

  // 4 — Filter to CCS2 only and map
  const result = availData.connectors
    .filter(c => c.type === TARGET_CONNECTOR)
    .map(c => ({
      type: c.type,
      typeLabel: 'CCS2',
      total: c.total,
      available: c.availability.current.available,
      occupied: c.availability.current.occupied + c.availability.current.reserved,
      outOfService: c.availability.current.outOfService,
      unknown: c.availability.current.unknown,
    }));

  if (!result.length) return null;

  // 5 — Sanity check: TomTom CCS2 total must not exceed OCM total stalls by more than 2×.
  //     CCS2 is a subset of all connectors so the OCM total is an upper bound.
  //     A large discrepancy almost always means TomTom matched a different nearby station.
  const ocmTotal = station.totalStalls;
  if (ocmTotal && ocmTotal > 0 && result[0].total > ocmTotal * 2) {
    // Wrong match — clear the cached mapping so it is retried on the next call
    const ctx = (globalThis as unknown as { ctx: ExecutionContext }).ctx;
    ctx.waitUntil(deleteTomTomMapping(env, station.id).catch(() => {}));
    return null;
  }

  return result;
}
