import { Env, Station } from './types';

const OCM_BASE = 'https://api.openchargemap.io/v3/poi/';
const MIN_POWER_KW = 150;
const MAX_POWER_KW = 500; // sanity cap — bad OCM data exists above this

// DC connector type IDs — more reliable than levelid= for filtering
// 2 = CHAdeMO, 25 = CCS Type 2 (EU), 33 = CCS Type 1 (SAE Combo)
const DC_CONNECTION_TYPE_IDS = '2,25,33';

interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function maxPowerKw(connections: OcmConnection[]): number | null {
  const values = connections
    .map(c => c.PowerKW)
    .filter((kw): kw is number => typeof kw === 'number' && kw > 0 && kw <= MAX_POWER_KW);
  return values.length ? Math.max(...values) : null;
}

interface OcmConnection {
  PowerKW?: number | null;
  ConnectionType?: { Title?: string } | null;
}

interface OcmStation {
  ID: number;
  AddressInfo: {
    Title?: string;
    AddressLine1?: string;
    Town?: string;
    Postcode?: string;
    Latitude: number;
    Longitude: number;
    Country?: { ISOCode?: string };
  };
  OperatorInfo?: { Title?: string } | null;
  Connections?: OcmConnection[] | null;
  NumberOfPoints?: number | null;
  DateLastStatusUpdate?: string | null;
}

function toStation(s: OcmStation): Station | null {
  const addr = s.AddressInfo;
  const connections = s.Connections ?? [];
  const maxKw = maxPowerKw(connections);
  if (!maxKw || maxKw < MIN_POWER_KW) return null;

  return {
    id: String(s.ID),
    name: addr.Title ?? 'Unknown',
    operator: s.OperatorInfo?.Title ?? null,
    lat: addr.Latitude,
    lng: addr.Longitude,
    max_power_kw: maxKw,
    total_stalls: s.NumberOfPoints ?? null,
    connectors: connections
      .filter(c => c.PowerKW && c.PowerKW > 0 && c.PowerKW <= MAX_POWER_KW)
      .map(c => ({ type: c.ConnectionType?.Title ?? 'Unknown', powerKw: c.PowerKW as number })),
    address: [addr.AddressLine1, addr.Town, addr.Postcode].filter(Boolean).join(', ') || null,
    country: addr.Country?.ISOCode ?? null,
  };
}

/**
 * Fetch high-power DC stations from OCM within the given bounding box.
 * Uses the polyline= parameter if provided (tighter corridor), otherwise
 * falls back to a radius query from the bbox centre.
 */
export async function fetchStationsFromOCM(
  env: Env,
  bbox: BBox,
  encodedPolyline?: string,
): Promise<Station[]> {
  const params: Record<string, string> = {
    key: env.OCM_API_KEY,
    connectiontypeid: DC_CONNECTION_TYPE_IDS,
    minpowerkilowatts: String(MIN_POWER_KW),
    statustype: '50',    // operational only
    maxresults: '500',
    compact: 'false',
    verbose: 'false',
  };

  if (encodedPolyline) {
    params['polyline'] = encodedPolyline;
    params['distance'] = '3';
    params['distanceunit'] = 'KM';
  } else {
    // Radius from bbox centre — covers the full bbox diagonal
    const centreLat = (bbox.minLat + bbox.maxLat) / 2;
    const centreLng = (bbox.minLng + bbox.maxLng) / 2;
    const latKm = (bbox.maxLat - bbox.minLat) * 111;
    const lngKm = (bbox.maxLng - bbox.minLng) * 111 * Math.cos((centreLat * Math.PI) / 180);
    const radiusKm = Math.ceil(Math.sqrt(latKm ** 2 + lngKm ** 2) / 2) + 5;

    params['latitude'] = String(centreLat);
    params['longitude'] = String(centreLng);
    params['distance'] = String(radiusKm);
    params['distanceunit'] = 'KM';
  }

  const url = new URL(OCM_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OCM API error ${res.status}: ${await res.text()}`);

  const raw = await res.json() as OcmStation[];
  return raw.map(toStation).filter((s): s is Station => s !== null);
}
