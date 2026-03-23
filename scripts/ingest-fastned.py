#!/usr/bin/env python3
"""
Fastned charging station ingestion into Supabase.

Scrapes the Fastned locations page for all station IDs + coordinates, then
fetches the detail API for each OPEN station to get name, country, and
connector data. Upserts into the Supabase `stations` table.

Source: https://www.fastnedcharging.com/en/locations
No authentication required.

Usage:
  python3 scripts/ingest-fastned.py           # all open stations globally
  python3 scripts/ingest-fastned.py --dry-run # print without upserting

Credentials read from env vars or worker/.dev.vars:
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

LOCATIONS_PAGE_URL  = 'https://www.fastnedcharging.com/en/locations'
DETAIL_API_BASE_URL = 'https://www.fastnedcharging.com/api/v1/maplocations'

# Only ingest stations with these statuses
OPEN_STATUSES = {'OPEN', 'OPENING_SOON'}

# Fastned connector name → our type
CONNECTOR_TYPE_MAP = {
    'CCS':     'CCS (Type 2)',
    'CHADEMO': 'CHAdeMO',
    'AC':      'Type 2 (AC)',
}

# 3-letter ISO 3166-1 alpha-3 → alpha-2
COUNTRY_ALPHA3_TO_2: dict[str, str] = {
    'NLD': 'NL', 'DEU': 'DE', 'FRA': 'FR', 'BEL': 'BE',
    'CHE': 'CH', 'GBR': 'GB', 'AUT': 'AT', 'SWE': 'SE',
    'DNK': 'DK', 'NOR': 'NO', 'POL': 'PL', 'ESP': 'ES',
    'PRT': 'PT', 'ITA': 'IT', 'CZE': 'CZ', 'HUN': 'HU',
    'ROU': 'RO', 'SVK': 'SK', 'SVN': 'SI', 'HRV': 'HR',
    'LUX': 'LU', 'FIN': 'FI', 'IRL': 'IE', 'BGR': 'BG',
    'LTU': 'LT', 'LVA': 'LV', 'EST': 'EE', 'GRC': 'GR',
    'USA': 'US', 'CAN': 'CA', 'AUS': 'AU', 'JPN': 'JP',
    'KOR': 'KR', 'ISL': 'IS',
}

MIN_POWER_KW = 50
BATCH_SIZE   = 200
USER_AGENT   = 'FreewayCharge/1.0 (EV route planner; non-commercial)'


# ── credentials ───────────────────────────────────────────────────────────────

def load_dev_vars(path: str) -> dict:
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
    dev_vars = load_dev_vars(
        os.path.join(os.path.dirname(__file__), '..', 'worker', '.dev.vars')
    )
    url = (os.environ.get('SUPABASE_URL', '') or dev_vars.get('SUPABASE_URL', '')).rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '') or dev_vars.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not found.', file=sys.stderr)
        sys.exit(1)
    return url, key


# ── fetch location list ───────────────────────────────────────────────────────

def fetch_location_list() -> list[dict]:
    """
    Fetch the Fastned locations page and extract the station list from the
    data-locations attribute on the Google Maps container.
    """
    print(f'Fetching {LOCATIONS_PAGE_URL} …')
    req = urllib.request.Request(
        LOCATIONS_PAGE_URL,
        headers={'User-Agent': USER_AGENT},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        print(f'ERROR: page fetch failed (HTTP {e.code})', file=sys.stderr)
        sys.exit(1)

    m = re.search(r'data-locations="([^"]+)"', html)
    if not m:
        print('ERROR: could not find data-locations in page HTML', file=sys.stderr)
        sys.exit(1)

    # HTML-entity encoded JSON
    raw = m.group(1).replace('&quot;', '"').replace('&#34;', '"').replace('&amp;', '&')
    locations = json.loads(raw)
    print(f'Found {len(locations):,} locations in page HTML')
    return locations


# ── fetch station detail ──────────────────────────────────────────────────────

def fetch_detail(station_id: str) -> dict | None:
    """Fetch detail for a single station; return None on error."""
    url = f'{DETAIL_API_BASE_URL}/{station_id}'
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
        return data.get('location')
    except Exception:
        return None


# ── mapping ───────────────────────────────────────────────────────────────────

def map_station(loc_stub: dict, detail: dict) -> dict | None:
    """Combine stub (lat/lng/id) with detail (name/connectors) into a station row."""
    try:
        lat = float(loc_stub['coordinates']['latitude'])
        lng = float(loc_stub['coordinates']['longitude'])
    except (KeyError, ValueError, TypeError):
        return None

    connectors_raw = detail.get('connectors') or []
    connectors: list[dict] = []
    max_power_kw = 0

    for c in connectors_raw:
        power = int(c.get('power') or 0)
        name  = (c.get('name') or '').upper()
        ctype = CONNECTOR_TYPE_MAP.get(name)
        if not ctype or power < MIN_POWER_KW:
            continue
        connectors.append({'type': ctype, 'powerKw': power})
        if power > max_power_kw:
            max_power_kw = power

    if not connectors or max_power_kw < MIN_POWER_KW:
        return None

    # Country: API returns 3-letter code, convert to 2-letter
    country_raw = (detail.get('country') or '').upper()
    country = COUNTRY_ALPHA3_TO_2.get(country_raw, country_raw[:2] if country_raw else 'XX')

    # Address: combine address + city
    addr_parts = [detail.get('address'), detail.get('city')]
    address = ', '.join(p for p in addr_parts if p) or None

    # Stall count = sum of DC connector totals
    total_stalls = sum(
        int(c.get('total') or 0)
        for c in connectors_raw
        if (c.get('name') or '').upper() in ('CCS', 'CHADEMO')
    ) or None

    return {
        'id':           f"fastned:{detail['id']}",
        'name':         detail.get('name') or 'Fastned',
        'operator':     'Fastned',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': max_power_kw,
        'total_stalls': total_stalls,
        'connectors':   connectors,
        'address':      address,
        'country':      country,
        'source':       'fastned',
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
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f'Supabase upsert failed (HTTP {e.code}): {body}')


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='Print mapped stations without upserting')
    parser.add_argument('--workers', type=int, default=8,
                        help='Parallel workers for detail API calls (default 8)')
    args = parser.parse_args()

    supa_url, supa_key = get_credentials()
    print(f'Supabase: {supa_url}')

    # ── 1. get location list ──────────────────────────────────────────────────
    location_stubs = fetch_location_list()
    open_stubs = [s for s in location_stubs if s.get('status') in OPEN_STATUSES]
    print(f'OPEN/OPENING_SOON: {len(open_stubs):,}  (skipping {len(location_stubs) - len(open_stubs):,} closed)')

    # ── 2. fetch details in parallel ─────────────────────────────────────────
    print(f'Fetching details for {len(open_stubs):,} stations ({args.workers} workers) …')
    details: dict[str, dict] = {}
    errors = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_detail, s['id']): s for s in open_stubs}
        done = 0
        for future in as_completed(futures):
            stub = futures[future]
            detail = future.result()
            done += 1
            if detail:
                details[stub['id']] = detail
            else:
                errors += 1
            if done % 50 == 0 or done == len(open_stubs):
                print(f'  Details: {done:,}/{len(open_stubs):,}', end='\r', flush=True)
    print()
    if errors:
        print(f'  {errors} detail fetch errors (skipped)')

    # ── 3. map to station rows ────────────────────────────────────────────────
    stations: list[dict] = []
    skipped = 0
    for stub in open_stubs:
        detail = details.get(stub['id'])
        if not detail:
            skipped += 1
            continue
        s = map_station(stub, detail)
        if s:
            stations.append(s)
        else:
            skipped += 1

    print(f'Mapped {len(stations):,} DC fast-charge stations, skipped {skipped:,}')

    # Country summary
    countries: dict[str, int] = {}
    for s in stations:
        c = s['country']
        countries[c] = countries.get(c, 0) + 1
    print('\nCountries:')
    for c, n in sorted(countries.items(), key=lambda x: -x[1]):
        print(f'  {n:4d}  {c}')
    print()

    if args.dry_run:
        print('DRY RUN — not upserting.')
        if stations:
            print('Sample:')
            print(json.dumps(stations[0], indent=2))
        return

    # ── 4. upsert ─────────────────────────────────────────────────────────────
    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        upsert_batch(supa_url, supa_key, stations[i : i + BATCH_SIZE])
        inserted += len(stations[i : i + BATCH_SIZE])
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} Fastned stations upserted to Supabase.')


if __name__ == '__main__':
    main()
