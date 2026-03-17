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

export interface StationOnRoute {
  station: Station;
  distanceAlongRouteMeters: number;
  detourMeters: number;
  score: number;
}
