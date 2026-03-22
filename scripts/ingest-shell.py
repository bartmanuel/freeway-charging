#!/usr/bin/env python3
"""
Shell Recharge EV charging station ingestion into Supabase.

Fetches all public Shell Recharge locations via the Shell EV Public Locations
API (v2) and upserts DC fast-charge stations (≥50 kW, CCS/CHAdeMO) into the
Supabase `stations` table.

Usage:
  # Credentials from environment or worker/.dev.vars
  python3 scripts/ingest-shell.py

  # Override minimum power (default 50 kW)
  python3 scripts/ingest-shell.py --min-kw 100

  # Dry-run: print mapped stations without upserting
  python3 scripts/ingest-shell.py --dry-run

Credentials read from env vars or worker/.dev.vars:
  SHELL_CONSUMER_KEY        — OAuth2 client_id from developer.shell.com
  SHELL_CONSUMER_SECRET     — OAuth2 client_secret
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SHELL_TOKEN_URL     = 'https://api.shell.com/v2/oauth/token'
SHELL_LOCATIONS_URL = 'https://api.shell.com/ev/v2/locations'

# Shell connector type strings → human-readable label
DC_CONNECTOR_LABELS = {
    'CCS':      'CCS (Type 2)',
    'CHAdeMO':  'CHAdeMO',
    'CCS1':     'CCS (Type 1)',  # North America
}

DEFAULT_MIN_KW = 50
MAX_POWER_KW   = 1000
BATCH_SIZE     = 200
REQUEST_DELAY  = 0.25  # seconds between paginated requests


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


def get_credentials() -> tuple[str, str, str, str]:
    dev_vars = load_dev_vars(
        os.path.join(os.path.dirname(__file__), '..', 'worker', '.dev.vars')
    )

    def env(key: str) -> str:
        return os.environ.get(key, '') or dev_vars.get(key, '')

    shell_key    = env('SHELL_CONSUMER_KEY')
    shell_secret = env('SHELL_CONSUMER_SECRET')
    supa_url     = env('SUPABASE_URL').rstrip('/')
    supa_key     = env('SUPABASE_SERVICE_ROLE_KEY')

    missing = [k for k, v in {
        'SHELL_CONSUMER_KEY': shell_key,
        'SHELL_CONSUMER_SECRET': shell_secret,
        'SUPABASE_URL': supa_url,
        'SUPABASE_SERVICE_ROLE_KEY': supa_key,
    }.items() if not v]

    if missing:
        print(f'ERROR: missing credentials: {", ".join(missing)}', file=sys.stderr)
        sys.exit(1)

    return shell_key, shell_secret, supa_url, supa_key


# ── Shell API ─────────────────────────────────────────────────────────────────

def get_access_token(consumer_key: str, consumer_secret: str) -> str:
    payload = urllib.parse.urlencode({
        'grant_type':    'client_credentials',
        'client_id':     consumer_key,
        'client_secret': consumer_secret,
    }).encode('utf-8')
    req = urllib.request.Request(
        SHELL_TOKEN_URL,
        data=payload,
        method='POST',
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        token = data.get('access_token')
        if not token:
            print(f'ERROR: no access_token in response: {data}', file=sys.stderr)
            sys.exit(1)
        print(f'Got access token (expires in {data.get("expires_in", "?")}s)')
        return token
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f'ERROR: token request failed (HTTP {e.code}): {body}', file=sys.stderr)
        sys.exit(1)


def fetch_locations_page(token: str, offset: int, limit: int = 500) -> dict:
    params = urllib.parse.urlencode({'offset': offset, 'limit': limit})
    req = urllib.request.Request(
        f'{SHELL_LOCATIONS_URL}?{params}',
        headers={'Authorization': f'Bearer {token}'},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def fetch_all_locations(token: str) -> list[dict]:
    """Fetch all locations via paginated GET /ev/v2/locations."""
    locations: list[dict] = []
    offset = 0
    limit  = 500

    while True:
        print(f'  Fetching offset={offset} …', end='\r', flush=True)
        try:
            page = fetch_locations_page(token, offset, limit)
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f'\nERROR: locations request failed (HTTP {e.code}): {body}', file=sys.stderr)
            sys.exit(1)

        # Response may be a dict with a `data` list, or a plain list
        if isinstance(page, list):
            batch = page
        else:
            batch = page.get('data') or []

        if not batch:
            break

        locations.extend(batch)
        print(f'  Fetched {len(locations):,} locations …', end='\r', flush=True)

        # If we got fewer than the page size, we're done
        if len(batch) < limit:
            break

        offset += limit
        time.sleep(REQUEST_DELAY)

    print(f'  Fetched {len(locations):,} locations total         ')
    return locations


# ── mapping ───────────────────────────────────────────────────────────────────

def map_location(loc: dict, min_kw: float) -> dict | None:
    """Map a Shell location object to a Supabase station row. Returns None if
    the location has no DC fast connectors meeting the power threshold."""
    coords = loc.get('coordinates') or {}
    try:
        lat = float(coords['latitude'])
        lng = float(coords['longitude'])
    except (KeyError, TypeError, ValueError):
        return None

    evses = loc.get('evses') or []
    max_power_kw   = 0.0
    dc_stall_count = 0
    connectors: list[dict] = []

    for evse in evses:
        evse_dc: list[dict] = []
        for conn in (evse.get('connectors') or []):
            ctype = (conn.get('connectorType') or '').strip()
            if ctype not in DC_CONNECTOR_LABELS:
                continue
            elec = conn.get('electricalProperties') or {}
            power_kw = float(elec.get('maxElectricPower') or 0)
            if power_kw < min_kw or power_kw > MAX_POWER_KW:
                continue
            evse_dc.append({
                'type':    DC_CONNECTOR_LABELS[ctype],
                'powerKw': round(power_kw),
            })
            max_power_kw = max(max_power_kw, power_kw)

        if evse_dc:
            dc_stall_count += 1
            connectors.extend(evse_dc)

    if dc_stall_count == 0:
        return None

    # Build address
    addr_obj = loc.get('address') or {}
    address = ', '.join(
        p for p in [addr_obj.get('street'), addr_obj.get('city')] if p
    ) or None
    country = (addr_obj.get('country') or 'XX')[:2].upper()

    # Name: use location name if available, else operator name, else uid
    name = (
        loc.get('name')
        or loc.get('operatorName')
        or f"Shell {loc.get('uid', '')}"
    ).strip() or 'Unknown'

    uid = str(loc.get('uid') or loc.get('externalId') or '')
    if not uid:
        return None

    return {
        'id':           f'shell:{uid}',
        'name':         name,
        'operator':     loc.get('operatorName') or 'Shell Recharge',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': min(int(max_power_kw), MAX_POWER_KW),
        'total_stalls': dc_stall_count,
        'connectors':   connectors,
        'address':      address,
        'country':      country,
        'source':       'shell',
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
    parser.add_argument('--min-kw',   type=float, default=DEFAULT_MIN_KW,
                        help=f'Minimum connector power in kW (default {DEFAULT_MIN_KW})')
    parser.add_argument('--dry-run',  action='store_true',
                        help='Print mapped stations without upserting to Supabase')
    args = parser.parse_args()

    shell_key, shell_secret, supa_url, supa_key = get_credentials()
    print(f'Supabase: {supa_url}')

    # ── authenticate ──────────────────────────────────────────────────────────
    token = get_access_token(shell_key, shell_secret)

    # ── fetch all locations ───────────────────────────────────────────────────
    print('Fetching Shell Recharge locations …')
    raw_locations = fetch_all_locations(token)
    print(f'Loaded {len(raw_locations):,} raw locations from Shell API')

    # ── filter and map ────────────────────────────────────────────────────────
    stations: list[dict] = []
    skipped = 0
    for loc in raw_locations:
        station = map_location(loc, args.min_kw)
        if station:
            stations.append(station)
        else:
            skipped += 1

    # Deduplicate by id
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

    # ── operator / country summary ────────────────────────────────────────────
    ops: dict[str, int] = {}
    countries: dict[str, int] = {}
    for s in stations:
        op = s.get('operator') or 'Unknown'
        ops[op] = ops.get(op, 0) + 1
        c = s.get('country') or 'XX'
        countries[c] = countries.get(c, 0) + 1

    print('\nTop 20 operators:')
    for op, count in sorted(ops.items(), key=lambda x: -x[1])[:20]:
        print(f'  {count:4d}  {op}')

    print('\nCountries:')
    for c, count in sorted(countries.items(), key=lambda x: -x[1]):
        print(f'  {count:4d}  {c}')
    print()

    if args.dry_run:
        print('DRY RUN — not upserting to Supabase.')
        if stations:
            print('Sample station:')
            print(json.dumps(stations[0], indent=2))
        return

    # ── upsert to Supabase ────────────────────────────────────────────────────
    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = stations[i : i + BATCH_SIZE]
        upsert_batch(supa_url, supa_key, batch)
        inserted += len(batch)
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} Shell Recharge stations upserted to Supabase.')


if __name__ == '__main__':
    main()
