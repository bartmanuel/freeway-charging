export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  GOOGLE_API_KEY: string;
  TOMTOM_API_KEY: string;
  OCM_API_KEY: string;
}

export interface Station {
  id: string;
  name: string;
  operator: string | null;
  lat: number;
  lng: number;
  max_power_kw: number | null;
  total_stalls: number | null;
  connectors: { type: string; powerKw: number }[] | null;
  address: string | null;
  country: string | null;
}

