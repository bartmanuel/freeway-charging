-- Track where each station record originates.
-- 'ocm'   = OpenChargeMap (on-demand cache from corridor searches)
-- 'ndw'   = Netherlands NDW OCPI bulk dataset
-- 'shell' = Shell Recharge developer API
-- Future sources added here.
alter table stations add column if not exists source text not null default 'ocm';

create index if not exists stations_source_idx on stations (source);
