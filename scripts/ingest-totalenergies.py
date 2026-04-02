#!/usr/bin/env python3
"""
TotalEnergies charging station ingestion into Supabase.

Fetches the complete European station dataset from the TotalEnergies Charging
Services API (the backend powering chargingservices.totalenergies.com/en/find-a-charger).
The API returns all stations in a single gzip-compressed JSON response (~70 MB).

Filter criteria:
  - CCS (Type 2) connector present
  - Max power ≥ MIN_POWER_KW (175 kW)
  - DC stall count ≥ MIN_STALLS (6)
  - Country in the standard EU/UK coverage set

Usage:
  python3 scripts/ingest-totalenergies.py             # full run
  python3 scripts/ingest-totalenergies.py --dry-run   # print without upserting
  python3 scripts/ingest-totalenergies.py --countries NL,DE,BE

Credentials read from env vars or worker/.dev.vars:
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import argparse
import gzip
import json
import os
import sys
import urllib.error
import urllib.request

# ── TotalEnergies API ─────────────────────────────────────────────────────────

LOCATIONS_URL = (
    'https://prod.apix.alzp.tgscloud.net'
    '/evdc-bff-europe/v0.0.1/v3/infrastructure/locations'
)
API_KEY       = '8PTnp42eNZIdfOPKdyQB4GRzQwlCGsOQS3HBP5FvRyFRk8ns'
MARKETPLACE   = 'tcseu'
USER_AGENT    = 'FreewayCharge/1.0 (EV route planner; non-commercial)'

# ── filter thresholds ─────────────────────────────────────────────────────────

MIN_STALLS    = 6      # minimum CCS2 stalls (EVSEs) per station
MIN_POWER_KW  = 175    # minimum CCS2 max power per EVSE (kW)
MAX_POWER_KW  = 1000   # sanity cap for bad data

# ── geography ─────────────────────────────────────────────────────────────────

# Same country set as the other CPO scripts.
COVERAGE_COUNTRIES = {
    'NL', 'DE', 'BE', 'FR', 'GB', 'AT', 'CH', 'ES', 'PT',
    'IT', 'PL', 'DK', 'SE', 'NO', 'IE', 'LU',
}

# ── connector type mapping ────────────────────────────────────────────────────

# TotalEnergies API uses short proprietary type codes (confirmed from live data):
#   COMBO   = CCS (Type 2) — DC fast charge
#   T2      = Type 2 AC
#   CHADEMO = CHAdeMO — DC fast charge
#   EF      = French domestic / Schuko (slow AC)
#   T1      = Type 1 / J1772 (slow AC)
CCS2_TYPES = {'COMBO'}

CONNECTOR_TYPE_MAP = {
    'COMBO':   'CCS (Type 2)',
    'CHADEMO': 'CHAdeMO',
    'T2':      'Type 2 (AC)',
    'T1':      'Type 1 (AC)',
    'EF':      'Schuko (AC)',
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

def fetch_locations() -> list[dict]:
    """Fetch the complete TotalEnergies station dataset (~70 MB gzipped)."""
    print('Fetching TotalEnergies station dataset (this may take ~30 s) …')
    req = urllib.request.Request(
        LOCATIONS_URL,
        headers={
            'x-apif-apikey':   API_KEY,
            'marketplace-evp': MARKETPLACE,
            'Accept':          'application/json',
            'Accept-Encoding': 'gzip',
            'User-Agent':      USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
    except Exception as e:
        print(f'ERROR: failed to fetch locations: {e}', file=sys.stderr)
        sys.exit(1)

    # Decompress if gzip (API always returns gzip but check the magic bytes)
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)

    data = json.loads(raw)
    # API may return a list directly or wrap it
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ('locations', 'data', 'results', 'items'):
            if isinstance(data.get(key), list):
                return data[key]
    return []


# ── mapping ───────────────────────────────────────────────────────────────────

def map_station(loc: dict, coverage: set[str]) -> dict | None:
    """
    Map one TotalEnergies location to the standard station schema.
    Returns None if the station doesn't meet the filter criteria.

    Structure:
      location
        coordinates.latitude / longitude
        address.country / street / streetNumber / city
        name
        chargingSpots[]
          evses[]
            maxPower          (kW)
            connectors[]
              type            (string code)
    """
    # ── location filter ───────────────────────────────────────────────────────
    if not loc.get('publicLocation', True):
        return None

    addr = loc.get('address') or {}
    country = (addr.get('country') or '').upper()
    if coverage and country not in coverage:
        return None

    coords = loc.get('coordinates') or {}
    try:
        lat = float(coords['latitude'])
        lng = float(coords['longitude'])
    except (KeyError, ValueError, TypeError):
        return None

    # ── scan EVSEs for qualifying CCS2 stalls ─────────────────────────────────
    ccs2_stalls: list[int] = []   # power (kW) of each qualifying CCS2 EVSE
    all_connectors: list[dict] = []

    for spot in loc.get('chargingSpots') or []:
        for evse in spot.get('evses') or []:
            try:
                evse_power = float(evse.get('maxPower') or 0)
            except (ValueError, TypeError):
                evse_power = 0.0

            if evse_power < MIN_POWER_KW or evse_power > MAX_POWER_KW:
                continue

            # Check if this EVSE has a CCS2 connector
            has_ccs2 = False
            for conn in evse.get('connectors') or []:
                raw = (conn.get('type') or '').upper().replace('-', '_').replace(' ', '_')
                if raw in CCS2_TYPES:
                    has_ccs2 = True
                label = CONNECTOR_TYPE_MAP.get(raw, raw)
                power_int = int(evse_power)
                # Deduplicate connector type+power combos across EVSEs
                entry = {'type': label, 'powerKw': power_int}
                if entry not in all_connectors:
                    all_connectors.append(entry)

            if has_ccs2:
                ccs2_stalls.append(int(evse_power))

    if len(ccs2_stalls) < MIN_STALLS:
        return None

    max_power = max(ccs2_stalls)
    total_stalls = len(ccs2_stalls)

    # Only keep DC connectors (≥ MIN_POWER_KW) in the output
    connectors = [c for c in all_connectors if c['powerKw'] >= MIN_POWER_KW]
    if not connectors:
        return None

    # ── build address string ──────────────────────────────────────────────────
    addr_parts = [
        ' '.join(p for p in [addr.get('street'), addr.get('streetNumber')] if p),
        addr.get('city'),
    ]
    address = ', '.join(p for p in addr_parts if p) or None

    loc_id = loc.get('id') or f"{lat:.5f}:{lng:.5f}"

    return {
        'id':           f'totalenergies:{loc_id}',
        'name':         loc.get('name') or 'TotalEnergies',
        'operator':     'TotalEnergies',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': max_power,
        'total_stalls': total_stalls,
        'connectors':   connectors,
        'address':      address,
        'country':      country,
        'source':       'totalenergies',
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
    parser.add_argument('--countries',
                        default=','.join(sorted(COVERAGE_COUNTRIES)),
                        help=f'Comma-separated ISO-2 country codes '
                             f'(default: all {len(COVERAGE_COUNTRIES)} covered countries)')
    args = parser.parse_args()

    countries_arg = [c.strip().upper() for c in args.countries.split(',') if c.strip()]
    unknown = [c for c in countries_arg if c not in COVERAGE_COUNTRIES]
    if unknown:
        print(f'WARNING: countries not in standard coverage (still fetched): {unknown}',
              file=sys.stderr)
    coverage = set(countries_arg)

    if not args.dry_run:
        supa_url, supa_key = get_credentials()
        print(f'Supabase: {supa_url}')

    # ── 1. fetch complete dataset ─────────────────────────────────────────────
    locations = fetch_locations()
    print(f'Total locations in API response: {len(locations):,}')

    # ── 2. map + filter ───────────────────────────────────────────────────────
    stations: list[dict] = []
    skipped_country = 0
    skipped_filter  = 0

    for loc in locations:
        addr = loc.get('address') or {}
        country = (addr.get('country') or '').upper()
        if country not in coverage:
            skipped_country += 1
            continue
        s = map_station(loc, coverage)
        if s:
            stations.append(s)
        else:
            skipped_filter += 1

    print(f'Outside coverage countries: {skipped_country:,}')
    print(f'Filtered out (< {MIN_STALLS} CCS2 stalls ≥ {MIN_POWER_KW} kW): {skipped_filter:,}')
    print(f'Qualifying stations: {len(stations):,}')

    # ── 3. vital statistics ───────────────────────────────────────────────────
    if stations:
        powers = [s['max_power_kw'] for s in stations]
        stalls = [s['total_stalls'] for s in stations]
        print(f'\nMax power  — min: {min(powers)} kW, max: {max(powers)} kW, '
              f'avg: {sum(powers)/len(powers):.0f} kW')
        print(f'CCS2 stalls— min: {min(stalls)}, max: {max(stalls)}, '
              f'avg: {sum(stalls)/len(stalls):.1f}')

        country_count: dict[str, int] = {}
        for s in stations:
            c = s['country']
            country_count[c] = country_count.get(c, 0) + 1
        print('\nCountries:')
        for c, n in sorted(country_count.items(), key=lambda x: -x[1]):
            print(f'  {n:4d}  {c}')

        # Connector type distribution
        type_count: dict[str, int] = {}
        for s in stations:
            for conn in s['connectors']:
                t = conn['type']
                type_count[t] = type_count.get(t, 0) + 1
        print('\nConnector types (across qualifying stations):')
        for t, n in sorted(type_count.items(), key=lambda x: -x[1]):
            print(f'  {n:4d}  {t}')
        print()

    if args.dry_run:
        print('DRY RUN — not upserting.')
        if stations:
            print('Sample station:')
            print(json.dumps(stations[0], indent=2))
        return

    if not stations:
        print('No stations to upsert.')
        return

    # ── 4. upsert ─────────────────────────────────────────────────────────────
    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        upsert_batch(supa_url, supa_key, stations[i: i + BATCH_SIZE])
        inserted += len(stations[i: i + BATCH_SIZE])
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} TotalEnergies stations upserted to Supabase.')


if __name__ == '__main__':
    main()
