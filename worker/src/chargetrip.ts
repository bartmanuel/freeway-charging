import { Env, ChargerStatus } from './types';

const CHARGETRIP_URL = 'https://api.chargetrip.io/graphql';

const STATION_QUERY = `
  query GetStation($id: ID!) {
    station(id: $id) {
      id
      chargers {
        type
        power
        status {
          free
          busy
          unknown
          error
        }
      }
    }
  }
`;

interface ChargetripCharger {
  type: string;
  power: number;
  status: { free: number; busy: number; unknown: number; error: number };
}

interface ChargetripResponse {
  data?: {
    station?: {
      id: string;
      chargers: ChargetripCharger[];
    };
  };
  errors?: { message: string }[];
}

export async function fetchStationAvailability(
  env: Env,
  stationId: string,
): Promise<ChargerStatus[] | null> {
  const res = await fetch(CHARGETRIP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': env.CHARGETRIP_CLIENT_ID,
      'x-app-id': env.CHARGETRIP_APP_ID,
    },
    body: JSON.stringify({ query: STATION_QUERY, variables: { id: stationId } }),
  });

  if (!res.ok) return null;

  const json = await res.json() as ChargetripResponse;
  const station = json.data?.station;
  if (!station) return null;

  return station.chargers.map((c) => ({
    connectorType: c.type,
    powerKw: c.power,
    total: c.status.free + c.status.busy + c.status.unknown + c.status.error,
    free: c.status.free,
    busy: c.status.busy,
    unknown: c.status.unknown,
    error: c.status.error,
  }));
}
