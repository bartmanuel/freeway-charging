import type { Station, StationAvailability, ConnectorAvailability } from '../types/station';

const SEARCH_BASE = 'https://api.tomtom.com/search/2';

// TomTom connector type → human-readable label
const CONNECTOR_LABELS: Record<string, string> = {
  IEC62196Type2CCS: 'CCS2',
  IEC62196Type1CCS: 'CCS1',
  Chademo: 'CHAdeMO',
  IEC62196Type2CableAttached: 'Type 2',
  IEC62196Type2Outlet: 'Type 2',
  Tesla: 'Tesla',
};

// DC connector types we care about for matching (AC filtered out)
const DC_CONNECTOR_TYPES = new Set([
  'IEC62196Type2CCS',
  'IEC62196Type1CCS',
  'Chademo',
  'Tesla',
]);

// --- TomTom nearbySearch response types ---

interface TomTomConnectorSpec {
  connectorType: string;
  ratedPowerKW: number;
  currentType?: string;
}

interface TomTomNearbyResult {
  id: string;
  type: string;
  poi?: {
    name: string;
    brands?: { name: string }[];
  };
  address?: { freeformAddress?: string };
  position: { lat: number; lon: number };
  chargingPark?: {
    connectors: TomTomConnectorSpec[];
  };
  dataSources?: {
    chargingAvailability?: { id: string };
  };
}

interface TomTomNearbyResponse {
  results: TomTomNearbyResult[];
}

// --- TomTom chargingAvailability response types ---

interface TomTomAvailabilityCurrent {
  available: number;
  occupied: number;
  reserved: number;
  unknown: number;
  outOfService: number;
}

interface TomTomAvailabilityConnector {
  type: string;
  total: number;
  availability: {
    current: TomTomAvailabilityCurrent;
  };
}

interface TomTomAvailabilityResponse {
  connectors: TomTomAvailabilityConnector[];
}

// --- Matching helpers ---

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Normalise an operator/brand name for fuzzy comparison:
// lowercase, strip legal suffixes, collapse whitespace, remove punctuation.
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

// DC connector types present in a TomTom nearby result
function tomtomDcTypes(result: TomTomNearbyResult): Set<string> {
  const types = new Set<string>();
  for (const c of result.chargingPark?.connectors ?? []) {
    if (DC_CONNECTOR_TYPES.has(c.connectorType)) types.add(c.connectorType);
  }
  return types;
}

// OCM connector type titles → TomTom equivalents (for overlap check)
function ocmDcTypes(station: Station): Set<string> {
  const types = new Set<string>();
  for (const c of station.connectors) {
    const t = c.type.toLowerCase();
    if (t.includes('ccs') && t.includes('type 2')) types.add('IEC62196Type2CCS');
    else if (t.includes('ccs') && t.includes('type 1')) types.add('IEC62196Type1CCS');
    else if (t.includes('chademo')) types.add('Chademo');
    else if (t.includes('tesla')) types.add('Tesla');
  }
  return types;
}

type Confidence = 'high' | 'medium' | 'none';

function matchConfidence(
  ocmStation: Station,
  tomtomResult: TomTomNearbyResult,
  distanceMeters: number,
): Confidence {
  if (distanceMeters > 100) return 'none';

  const brandName =
    tomtomResult.poi?.brands?.[0]?.name ?? tomtomResult.poi?.name ?? '';
  const ocmOperator = ocmStation.operator ?? ocmStation.name;

  const brandMatch = brandName.length > 0 && namesSimilar(brandName, ocmOperator);

  const ttTypes = tomtomDcTypes(tomtomResult);
  const ocmTypes = ocmDcTypes(ocmStation);
  // If OCM has no typed DC connectors we can't rule out a match on this criterion
  const connectorOverlap =
    ocmTypes.size === 0 || [...ocmTypes].some(t => ttTypes.has(t));

  if (distanceMeters <= 50 && brandMatch && connectorOverlap) return 'high';
  if (distanceMeters <= 100 && (brandMatch || connectorOverlap)) return 'medium';
  return 'none';
}

// --- Public API ---

/**
 * Looks up a station in TomTom's Search API by proximity, verifies the match
 * via operator name + connector type, then fetches aggregated availability.
 * Returns null if no confident match is found or TomTom has no availability data.
 */
export async function lookupAndFetchAvailability(
  station: Station,
  apiKey: string,
): Promise<StationAvailability | null> {
  // Step 1 — nearby search to find TomTom's availability ID
  const searchParams = new URLSearchParams({
    key: apiKey,
    lat: String(station.lat),
    lon: String(station.lng),
    radius: '150',
    categorySet: '7309', // Electric Vehicle Station
    connectorSet: 'IEC62196Type2CCS',
    minPowerKW: '50',
    limit: '5',
  });

  let nearbyData: TomTomNearbyResponse;
  try {
    const res = await fetch(`${SEARCH_BASE}/nearbySearch/.json?${searchParams}`);
    if (!res.ok) return null;
    nearbyData = await res.json() as TomTomNearbyResponse;
  } catch {
    return null;
  }

  if (!nearbyData.results?.length) return null;

  // Step 2 — find best-matching result above confidence threshold
  let bestResult: TomTomNearbyResult | null = null;
  let bestConfidence: Confidence = 'none';
  let bestDistance = Infinity;

  for (const result of nearbyData.results) {
    const dist = haversineMeters(
      station.lat, station.lng,
      result.position.lat, result.position.lon,
    );
    const confidence = matchConfidence(station, result, dist);
    if (confidence === 'none') continue;
    if (confidence === 'high' && bestConfidence !== 'high') {
      bestResult = result; bestConfidence = confidence; bestDistance = dist;
    } else if (confidence === bestConfidence && dist < bestDistance) {
      bestResult = result; bestConfidence = confidence; bestDistance = dist;
    } else if (confidence === 'medium' && bestConfidence === 'none') {
      bestResult = result; bestConfidence = confidence; bestDistance = dist;
    }
  }

  if (!bestResult || bestConfidence === 'none') return null;

  const availabilityId = bestResult.dataSources?.chargingAvailability?.id;
  if (!availabilityId) return null;

  // Step 3 — fetch availability using TomTom's numeric ID
  const availParams = new URLSearchParams({
    key: apiKey,
    chargingAvailability: availabilityId,
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

  // Step 4 — map to our type, CCS2 only
  const connectors: ConnectorAvailability[] = availData.connectors
    .filter(c => c.type === 'IEC62196Type2CCS')
    .map((c): ConnectorAvailability => ({
      type: c.type,
      typeLabel: CONNECTOR_LABELS[c.type] ?? c.type,
      total: c.total,
      available: c.availability.current.available,
      occupied: c.availability.current.occupied + c.availability.current.reserved,
      outOfService: c.availability.current.outOfService,
      unknown: c.availability.current.unknown,
    }));

  return {
    fetchedAt: new Date().toISOString(),
    confidence: bestConfidence as 'high' | 'medium',
    connectors,
  };
}
