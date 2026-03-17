-- Phase 2 schema for Freeway Charge
-- Stations are sourced from OpenChargeMap and cached here.
-- Availability is polled from ChargeTrip and cached in Redis (30s TTL);
-- raw readings are also written here for trend aggregation.

-- earthdistance (+ cube dependency) needed for ll_to_earth spatial index
create extension if not exists cube cascade;
create extension if not exists earthdistance cascade;

-- ─── stations ────────────────────────────────────────────────────────────────
-- Mirrors OCM data. Refreshed weekly by a cron job.
create table if not exists stations (
  id            text primary key,          -- OCM AddressInfo.ID as string
  name          text not null,
  operator      text,
  lat           double precision not null,
  lng           double precision not null,
  max_power_kw  integer,
  total_stalls  integer,
  connectors    jsonb,                     -- array of { type, powerKw }
  address       text,
  country       char(2),                  -- ISO 3166-1 alpha-2
  ocm_updated   timestamptz,              -- DateLastStatusUpdate from OCM
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists stations_location_idx
  on stations using gist (ll_to_earth(lat, lng));

create index if not exists stations_country_idx on stations (country);
create index if not exists stations_power_idx   on stations (max_power_kw);

-- ─── station_availability ─────────────────────────────────────────────────────
-- Raw availability readings from ChargeTrip. Drives occupancy_trends aggregation.
-- Kept for 90 days (old rows purged by a cron job).
create table if not exists station_availability (
  id            bigserial primary key,
  station_id    text not null references stations (id) on delete cascade,
  sampled_at    timestamptz not null default now(),
  source        text not null default 'chargetrip',  -- 'chargetrip' | 'ocpi'
  chargers      jsonb not null  -- array of { connectorType, powerKw, total, free, busy, unknown, error }
);

create index if not exists availability_station_time_idx
  on station_availability (station_id, sampled_at desc);

-- ─── occupancy_trends ────────────────────────────────────────────────────────
-- Pre-aggregated hourly averages per station x day-of-week x hour.
-- Recomputed nightly by a Cloudflare Worker cron.
create table if not exists occupancy_trends (
  station_id      text not null references stations (id) on delete cascade,
  day_of_week     smallint not null check (day_of_week between 0 and 6),  -- 0=Sun
  hour            smallint not null check (hour between 0 and 23),
  avg_free_ratio  real not null,   -- 0.0 - 1.0
  sample_count    integer not null default 0,
  updated_at      timestamptz default now(),
  primary key (station_id, day_of_week, hour)
);

-- ─── helpers ─────────────────────────────────────────────────────────────────
-- Auto-update updated_at on stations
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger stations_set_updated_at
  before update on stations
  for each row execute procedure set_updated_at();
