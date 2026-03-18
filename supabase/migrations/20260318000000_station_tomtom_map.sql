-- Maps OCM station IDs to TomTom's chargingAvailability IDs.
-- Populated on first availability lookup; avoids repeating the nearbySearch.
create table if not exists station_tomtom_map (
  ocm_id          text primary key,   -- matches stations.id
  tomtom_avail_id text not null,       -- numeric string for chargingAvailability.json
  confidence      text not null,       -- 'high' | 'medium'
  created_at      timestamptz default now()
);
