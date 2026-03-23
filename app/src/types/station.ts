export interface Connector {
  type: string;
  powerKw: number | null;
}

export interface Station {
  id: string;
  name: string;
  operator: string | null;
  lat: number;
  lng: number;
  maxPowerKw: number;
  totalStalls: number | null;
  connectors: Connector[];
  address: string;
  country: string;
}

export interface ConnectorAvailability {
  type: string;       // TomTom connector type string e.g. "IEC62196Type2CCS"
  typeLabel: string;  // Human-readable e.g. "CCS2"
  total: number;
  available: number;
  occupied: number;
  outOfService: number;
  unknown: number;
}

export interface HistoryPoint {
  ts: string;    // ISO timestamp
  avail: number;
  total: number;
}

export interface StationAvailability {
  fetchedAt: string;
  connectors: ConnectorAvailability[];
  history: HistoryPoint[];
}

export interface StationOnRoute {
  station: Station;
  distanceAlongRouteMeters: number;
  detourMeters: number;
  score: number;
}

export interface Amenity {
  brand: string;   // normalised key e.g. 'mcdonalds', 'starbucks'
  name: string;    // raw display name from OSM
  distance: number; // metres from station
}
