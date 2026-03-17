export interface LatLng {
  lat: number;
  lng: number;
}

export interface Route {
  id: string;
  origin: string;
  destination: string;
  encodedPolyline: string;
  decodedPath: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
}
