export interface Connector {
  type: string;
  powerKw: number | null;
}

export interface Station {
  id: number;
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

export interface StationAvailability {
  fetchedAt: string;                      // ISO timestamp
  confidence: 'high' | 'medium';
  connectors: ConnectorAvailability[];
}

export interface StationOnRoute {
  station: Station;
  distanceAlongRouteMeters: number;
  detourMeters: number;
  score: number;
  availability?: StationAvailability;
}
