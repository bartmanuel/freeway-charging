#!/usr/bin/env python3
"""
NDW OCPI station ingestion into Supabase.

Downloads the Netherlands National Data Warehouse (NDW) charging-point
locations file (OCPI 2.x format) and upserts all DC fast-charge stations
(≥50 kW, CCS/CHAdeMO) into the Supabase `stations` table.

Usage:
  # Full run — downloads fresh data from NDW
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/ingest-ndw.py

  # Use a locally cached file (skips the download)
  python3 scripts/ingest-ndw.py --input /tmp/ndw_sample.json.gz

  # Override minimum power (default 50 kW)
  python3 scripts/ingest-ndw.py --min-kw 100

Credentials are read from environment variables or from worker/.dev.vars
as a fallback.
"""

import argparse
import gzip
import json
import os
import sys
import urllib.error
import urllib.request

NDW_URL = 'https://opendata.ndw.nu/charging_point_locations_ocpi.json.gz'

# OCPI connector standards → human-readable label stored in the DB
DC_STANDARDS = {
    'IEC_62196_T2_COMBO': 'CCS (Type 2)',
    'CHADEMO':            'CHAdeMO',
    'IEC_62196_T1_COMBO': 'CCS (Type 1)',
    'TESLA':              'Tesla',
}

DEFAULT_MIN_KW = 50
MAX_POWER_KW   = 1000   # sanity cap for bad data
BATCH_SIZE     = 200


# ── credentials ──────────────────────────────────────────────────────────────

def load_dev_vars(path: str) -> dict:
    """Parse key=value pairs from a wrangler .dev.vars file."""
    result = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1)
                    result[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return result


def get_credentials() -> tuple[str, str]:
    url = os.environ.get('SUPABASE_URL', '').rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        dev_vars = load_dev_vars(
            os.path.join(os.path.dirname(__file__), '..', 'worker', '.dev.vars')
        )
        url = url or dev_vars.get('SUPABASE_URL', '')
        key = key or dev_vars.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not found.\n'
              '  Set them as environment variables, or ensure worker/.dev.vars exists.',
              file=sys.stderr)
        sys.exit(1)
    return url.rstrip('/'), key


# ── OCPI → station mapping ────────────────────────────────────────────────────

def map_location(loc: dict, min_kw: float) -> dict | None:
    """
    Map an OCPI Location object to a Supabase station row.
    Returns None if the location has no DC fast connectors meeting the threshold.
    """
    coords = loc.get('coordinates') or {}
    try:
        lat = float(coords['latitude'])
        lng = float(coords['longitude'])
    except (KeyError, TypeError, ValueError):
        return None

    evses = loc.get('evses') or []
    max_power_kw  = 0.0
    dc_stall_count = 0
    connectors: list[dict] = []

    for evse in evses:
        evse_dc: list[dict] = []
        for conn in (evse.get('connectors') or []):
            standard = conn.get('standard') or ''
            if standard not in DC_STANDARDS:
                continue
            power_kw = (conn.get('max_electric_power') or 0) / 1000
            if power_kw < min_kw or power_kw > MAX_POWER_KW:
                continue
            evse_dc.append({
                'type':    DC_STANDARDS[standard],
                'powerKw': round(power_kw),
            })
            max_power_kw = max(max_power_kw, power_kw)

        if evse_dc:
            dc_stall_count += 1
            connectors.extend(evse_dc)

    if dc_stall_count == 0:
        return None

    operator_obj = loc.get('operator') or {}
    address = ', '.join(
        p for p in [loc.get('address'), loc.get('city')] if p
    ) or None
    country = (loc.get('country_code') or 'NL')[:2].upper()

    return {
        'id':           f"ndw:{loc['id']}",
        'name':         loc.get('name') or 'Unknown',
        'operator':     operator_obj.get('name'),
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': min(int(max_power_kw), MAX_POWER_KW),
        'total_stalls': dc_stall_count,
        'connectors':   connectors,
        'address':      address,
        'country':      country,
        'source':       'ndw',
    }


# ── Supabase upsert ───────────────────────────────────────────────────────────

def upsert_batch(supabase_url: str, key: str, batch: list[dict]) -> None:
    payload = json.dumps(batch).encode('utf-8')
    req = urllib.request.Request(
        f'{supabase_url}/rest/v1/stations',
        data=payload,
        method='POST',
        headers={
            'apikey':        key,
            'Authorization': f'Bearer {key}',
            'Content-Type':  'application/json',
            'Prefer':        'resolution=merge-duplicates,return=minimal',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            _ = resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f'Supabase upsert failed (HTTP {e.code}): {body}')


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--input',  help='Path to a local .json.gz file (skips download)')
    parser.add_argument('--min-kw', type=float, default=DEFAULT_MIN_KW,
                        help=f'Minimum connector power in kW (default {DEFAULT_MIN_KW})')
    args = parser.parse_args()

    supabase_url, supabase_key = get_credentials()
    print(f'Supabase: {supabase_url}')

    # ── load OCPI data ────────────────────────────────────────────────────────
    if args.input:
        print(f'Loading from local file: {args.input}')
        with gzip.open(args.input, 'rb') as f:
            locations: list[dict] = json.load(f)
    else:
        print(f'Downloading NDW data from {NDW_URL} …')
        with urllib.request.urlopen(NDW_URL, timeout=120) as resp:
            compressed = resp.read()
        locations = json.loads(gzip.decompress(compressed))

    print(f'Loaded {len(locations):,} OCPI locations')

    # ── filter and map ────────────────────────────────────────────────────────
    stations: list[dict] = []
    skipped = 0
    for loc in locations:
        if not loc.get('publish', True):
            skipped += 1
            continue
        station = map_location(loc, args.min_kw)
        if station:
            stations.append(station)
        else:
            skipped += 1

    # Deduplicate by id (NDW can have multiple entries with the same location id)
    seen: set[str] = set()
    unique: list[dict] = []
    for s in stations:
        if s['id'] not in seen:
            seen.add(s['id'])
            unique.append(s)
    dupes = len(stations) - len(unique)
    stations = unique

    print(f'Mapped to {len(stations):,} DC fast-charge stations '
          f'(≥{args.min_kw:.0f} kW), skipped {skipped:,}'
          + (f', deduped {dupes}' if dupes else ''))

    # ── operator summary ──────────────────────────────────────────────────────
    ops: dict[str, int] = {}
    for s in stations:
        op = s.get('operator') or 'Unknown'
        ops[op] = ops.get(op, 0) + 1
    print('\nTop 20 operators:')
    for op, count in sorted(ops.items(), key=lambda x: -x[1])[:20]:
        print(f'  {count:4d}  {op}')
    print()

    # ── upsert to Supabase ────────────────────────────────────────────────────
    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = stations[i : i + BATCH_SIZE]
        upsert_batch(supabase_url, supabase_key, batch)
        inserted += len(batch)
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} NDW stations upserted to Supabase.')


if __name__ == '__main__':
    main()
