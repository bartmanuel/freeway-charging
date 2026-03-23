#!/usr/bin/env python3
"""
IONITY charging station ingestion into Supabase.

Fetches all locations from the IONITY public map data endpoint and upserts
active stations into the Supabase `stations` table.

Source: https://wf-assets.com/ionity/mapdata.json
No authentication required — this is the data powering ionity.eu/network.

Usage:
  python3 scripts/ingest-ionity.py           # all active sites globally
  python3 scripts/ingest-ionity.py --dry-run # print without upserting

Credentials read from env vars or worker/.dev.vars:
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

IONITY_MAP_URL = 'https://wf-assets.com/ionity/mapdata.json'

# Power tiers present in the data, highest first
POWER_TIERS = [
    ('connectors600kw', 600),
    ('connectors500kw', 500),
    ('connectors400kw', 400),
    ('connectors350kw', 350),
    ('connectors200kw', 200),
    ('connectors50kw',   50),
]

# Country name (lowercase) → ISO 3166-1 alpha-2
COUNTRY_CODES: dict[str, str] = {
    'netherlands': 'NL', 'germany': 'DE', 'france': 'FR', 'belgium': 'BE',
    'austria': 'AT', 'switzerland': 'CH', 'spain': 'ES', 'portugal': 'PT',
    'italy': 'IT', 'sweden': 'SE', 'norway': 'NO', 'denmark': 'DK',
    'finland': 'FI', 'poland': 'PL', 'czech-republic': 'CZ', 'czechia': 'CZ',
    'hungary': 'HU', 'slovakia': 'SK', 'slovenia': 'SI', 'croatia': 'HR',
    'romania': 'RO', 'bulgaria': 'BG', 'greece': 'GR', 'turkey': 'TR',
    'united-kingdom': 'GB', 'ireland': 'IE', 'luxembourg': 'LU',
    'lithuania': 'LT', 'latvia': 'LV', 'estonia': 'EE',
    'serbia': 'RS', 'ukraine': 'UA', 'iceland': 'IS',
}

BATCH_SIZE = 200


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


# ── fetch ─────────────────────────────────────────────────────────────────────

def fetch_mapdata() -> list[dict]:
    print(f'Fetching {IONITY_MAP_URL} …')
    req = urllib.request.Request(
        IONITY_MAP_URL,
        headers={'User-Agent': 'FreewayCharge/1.0 (EV route planner; non-commercial)'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        locations = data.get('LocationDetails', [])
        print(f'Fetched {len(locations):,} locations '
              f'({data.get("numberLocationsLive", "?")} active, '
              f'{data.get("numberLocationsPlanned", "?")} planned)')
        return locations
    except urllib.error.HTTPError as e:
        print(f'ERROR: fetch failed (HTTP {e.code})', file=sys.stderr)
        sys.exit(1)


# ── mapping ───────────────────────────────────────────────────────────────────

def make_station_id(loc: dict) -> str:
    """Stable ID from lat/lng (rounded to 5 decimal places)."""
    lat = round(float(loc['latitude']), 5)
    lng = round(float(loc['longitude']), 5)
    return f'ionity:{lat}:{lng}'


def map_location(loc: dict) -> dict | None:
    if loc.get('state') != 'active':
        return None

    try:
        lat = float(loc['latitude'])
        lng = float(loc['longitude'])
    except (KeyError, ValueError, TypeError):
        return None

    # Max power = highest tier with at least one connector
    max_power_kw = 0
    connectors: list[dict] = []
    for field, kw in POWER_TIERS:
        count = int(loc.get(field) or 0)
        if count > 0:
            if max_power_kw == 0:
                max_power_kw = kw  # first (highest) tier sets max
            connectors.append({'type': 'CCS (Type 2)', 'powerKw': kw})

    # Also add AC if present (though IONITY AC is not DC fast charge — include for completeness)
    # Skip AC — we want DC only, and all IONITY DC connectors are CCS
    if not connectors:
        return None

    country_raw = (loc.get('country') or '').lower()
    country = COUNTRY_CODES.get(country_raw, country_raw[:2].upper() if country_raw else 'XX')

    total_stalls = int(loc.get('connectorsTotal') or 0) - int(loc.get('connectorsAC') or 0)

    return {
        'id':           make_station_id(loc),
        'name':         loc.get('name') or 'IONITY',
        'operator':     'IONITY',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': max_power_kw,
        'total_stalls': total_stalls if total_stalls > 0 else None,
        'connectors':   connectors,
        'address':      None,  # not available in map data
        'country':      country,
        'source':       'ionity',
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
    args = parser.parse_args()

    supa_url, supa_key = get_credentials()
    print(f'Supabase: {supa_url}')

    raw = fetch_mapdata()

    stations: list[dict] = []
    skipped = 0
    for loc in raw:
        s = map_location(loc)
        if s:
            stations.append(s)
        else:
            skipped += 1

    print(f'Mapped {len(stations):,} active DC stations, skipped {skipped:,} (planned/no DC)')

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

    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        upsert_batch(supa_url, supa_key, stations[i : i + BATCH_SIZE])
        inserted += len(stations[i : i + BATCH_SIZE])
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} IONITY stations upserted to Supabase.')


if __name__ == '__main__':
    main()
