#!/usr/bin/env python3
"""
Shell Recharge charging station ingestion into Supabase.

Queries the Shell retail locator API (shellretaillocator.geoapp.me), which is the
public-facing service powering the station-finder map embedded on shell.nl and other
Shell country websites (via iframe from shell.nl/elektrisch-opladen/vind-een-oplaadpaal.html).
No authentication required.

Strategy:
  1. Tile Europe into 1-degree bounding-box cells (≥2° triggers cluster mode, so 1° is safe).
  2. Per tile: fetch stations filtered to `shell_recharge` fuel; deduplicate by ID.
  3. For stations that report EV amenities, fetch the detail endpoint which includes
     connector types, max power, and stall count (ev_charging.charging_points).
  4. Keep only DC fast-charge stations with ≥ MIN_STALLS stalls AND max_power ≥ MIN_POWER_KW.
  5. Upsert into the Supabase `stations` table.

Usage:
  python3 scripts/ingest-shell.py             # full EU run
  python3 scripts/ingest-shell.py --dry-run   # print without upserting
  python3 scripts/ingest-shell.py --countries NL,DE,BE

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
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL   = 'https://shellretaillocator.geoapp.me/api/v2'
USER_AGENT = 'FreewayCharge/1.0 (EV route planner; non-commercial)'

# Minimum number of DC stalls to include a station.
MIN_STALLS = 6
# Minimum power (kW) to count as a DC fast charger.
MIN_POWER_KW = 50.0

# Only fetch detail for stations that report at least one of these amenities.
# Stations without these are plain petrol stations with ≤2 slow charge points.
EV_AMENITIES = {'heavy_duty_ev', 'twenty_four_hour_ev_service', 'ev_service'}

# Per-country (lat_min, lat_max, lng_min, lng_max) used for tile generation.
COUNTRY_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    'NL': (50.7, 53.6,  3.3,  7.3),
    'DE': (47.2, 55.1,  5.8, 15.1),
    'BE': (49.5, 51.6,  2.5,  6.5),
    'FR': (41.3, 51.2, -5.2,  9.7),
    'GB': (49.9, 61.0, -8.2,  2.0),
    'AT': (46.4, 49.0,  9.5, 17.2),
    'CH': (45.8, 47.9,  5.9, 10.5),
    'ES': (36.0, 43.8, -9.3,  4.4),
    'PT': (37.0, 42.2, -9.5, -6.2),
    'IT': (36.6, 47.1,  6.6, 18.5),
    'PL': (49.0, 54.9, 14.1, 24.2),
    'DK': (54.6, 57.8,  8.1, 15.2),
    'SE': (55.3, 69.1, 10.9, 24.2),
    'NO': (57.9, 71.2,  4.5, 31.1),
    'IE': (51.4, 55.4,-10.7, -5.9),
    'LU': (49.4, 50.2,  5.7,  6.6),
}

ALL_COUNTRIES = sorted(COUNTRY_BOUNDS.keys())
BATCH_SIZE    = 200

# Shell connector type → our label
CONNECTOR_TYPE_MAP = {
    'type_2_combo':  'CCS (Type 2)',
    'chademo':       'CHAdeMO',
    'tepco_chademo': 'CHAdeMO',
    'ccs':           'CCS (Type 2)',
    'type_2':        'Type 2 (AC)',
}


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


# ── HTTP ──────────────────────────────────────────────────────────────────────

def http_get(url: str, timeout: int = 20) -> dict | list | None:
    req = urllib.request.Request(
        url,
        headers={
            'User-Agent': USER_AGENT,
            'Accept':     'application/json',
            'Referer':    'https://shellretaillocator.geoapp.me/',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


# ── tile generation ───────────────────────────────────────────────────────────

def generate_tiles(countries: list[str]) -> list[tuple[float, float, float, float]]:
    """Return deduplicated 1° (south, west, north, east) tiles covering given countries."""
    tiles: set[tuple[float, float, float, float]] = set()
    for country in countries:
        bounds = COUNTRY_BOUNDS.get(country)
        if not bounds:
            continue
        lat_min, lat_max, lng_min, lng_max = bounds
        lat = lat_min
        while lat < lat_max:
            lng = lng_min
            while lng < lng_max:
                tiles.add((lat, lng, lat + 1.0, lng + 1.0))
                lng += 1.0
            lat += 1.0
    return sorted(tiles)


# ── tile fetch (with automatic sub-tile fallback if clusters appear) ───────────

def fetch_tile(tile: tuple[float, float, float, float], depth: int = 0) -> list[dict]:
    """Fetch Shell Recharge station stubs within a bounding box."""
    south, west, north, east = tile
    url = (
        f'{BASE_URL}/locations/within_bounds'
        f'?sw[]={south:.6f}&sw[]={west:.6f}'
        f'&ne[]={north:.6f}&ne[]={east:.6f}'
        f'&filter%5Bfuels%5D%5B%5D=shell_recharge'
        f'&locale=en_GB&format=json&per_page=1000'
    )
    data = http_get(url)
    if not isinstance(data, dict):
        return []

    locations = data.get('locations') or []
    clusters  = data.get('clusters')  or []

    if clusters and not locations and depth < 2:
        # Split into four 0.5° sub-tiles and recurse
        mid_lat = (south + north) / 2
        mid_lng = (west  + east)  / 2
        result: list[dict] = []
        for sub in [
            (south, west,    mid_lat, mid_lng),
            (south, mid_lng, mid_lat, east),
            (mid_lat, west,  north,   mid_lng),
            (mid_lat, mid_lng, north, east),
        ]:
            result.extend(fetch_tile(sub, depth + 1))
        return result

    return locations


# ── detail fetch ──────────────────────────────────────────────────────────────

def fetch_detail(station_id: str) -> dict | None:
    url = f'{BASE_URL}/locations/{station_id}?locale=en_GB&format=json'
    data = http_get(url)
    return data if isinstance(data, dict) else None


# ── mapping ───────────────────────────────────────────────────────────────────

def map_station(detail: dict) -> dict | None:
    ev = detail.get('ev_charging') or {}
    if not ev:
        return None

    try:
        max_power = float(ev.get('max_power') or 0)
    except (ValueError, TypeError):
        max_power = 0.0

    if max_power < MIN_POWER_KW:
        return None

    charging_points = int(ev.get('charging_points') or 0)
    if charging_points < MIN_STALLS:
        return None

    try:
        lat = float(detail['lat'])
        lng = float(detail['lng'])
    except (KeyError, ValueError, TypeError):
        return None

    # Build connectors list — only DC connectors above threshold
    connectors: list[dict] = []
    for c in ev.get('connector_data') or []:
        try:
            power = float(c.get('max_power') or 0)
        except (ValueError, TypeError):
            power = 0.0
        if power < MIN_POWER_KW:
            continue
        raw_type = (c.get('type') or '').lower().replace('-', '_').replace(' ', '_')
        ctype = CONNECTOR_TYPE_MAP.get(raw_type, raw_type)
        connectors.append({'type': ctype, 'powerKw': int(power)})

    if not connectors:
        return None

    country = (detail.get('country_code') or 'XX').upper()
    addr_parts = [detail.get('address'), detail.get('city')]
    address = ', '.join(p for p in addr_parts if p) or None

    return {
        'id':           f"shell:{detail['id']}",
        'name':         detail.get('name') or 'Shell Recharge',
        'operator':     'Shell Recharge',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': int(max_power),
        'total_stalls': charging_points,
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
    parser.add_argument('--dry-run', action='store_true',
                        help='Print mapped stations without upserting')
    parser.add_argument('--countries', default=','.join(ALL_COUNTRIES),
                        help=f'Comma-separated ISO country codes (default: all {len(ALL_COUNTRIES)} countries)')
    parser.add_argument('--workers', type=int, default=8,
                        help='Parallel workers for HTTP calls (default 8)')
    args = parser.parse_args()

    countries = [c.strip().upper() for c in args.countries.split(',') if c.strip()]
    unknown = [c for c in countries if c not in COUNTRY_BOUNDS]
    if unknown:
        print(f'WARNING: unknown country codes (skipped): {unknown}', file=sys.stderr)
    countries = [c for c in countries if c in COUNTRY_BOUNDS]

    if not args.dry_run:
        supa_url, supa_key = get_credentials()
        print(f'Supabase: {supa_url}')
    else:
        supa_url = supa_key = ''

    # ── 1. generate tiles ─────────────────────────────────────────────────────
    tiles = generate_tiles(countries)
    print(f'Countries: {", ".join(countries)}')
    print(f'Tiles: {len(tiles):,} (1° cells)')

    # ── 2. fetch all tiles ────────────────────────────────────────────────────
    all_stubs: dict[str, dict] = {}
    tile_done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_tile, t): t for t in tiles}
        for future in as_completed(futures):
            for stub in future.result():
                all_stubs[str(stub['id'])] = stub
            tile_done += 1
            if tile_done % 20 == 0 or tile_done == len(tiles):
                print(f'  Tiles: {tile_done:,}/{len(tiles):,}  unique stations: {len(all_stubs):,}',
                      end='\r', flush=True)
    print()
    print(f'Found {len(all_stubs):,} unique Shell Recharge stations')

    # ── 3. filter to EV-amenity stations before fetching details ─────────────
    ev_stubs = {
        sid: stub for sid, stub in all_stubs.items()
        if EV_AMENITIES & set(stub.get('amenities') or [])
    }
    print(f'Stations with EV amenity: {len(ev_stubs):,}  →  fetching details …')

    # ── 4. fetch details in parallel ──────────────────────────────────────────
    details: dict[str, dict] = {}
    errors = 0
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_detail, sid): sid for sid in ev_stubs}
        for future in as_completed(futures):
            sid = futures[future]
            detail = future.result()
            done += 1
            if detail:
                details[sid] = detail
            else:
                errors += 1
            if done % 20 == 0 or done == len(ev_stubs):
                print(f'  Details: {done:,}/{len(ev_stubs):,}', end='\r', flush=True)
    print()
    if errors:
        print(f'  {errors} detail fetch errors (skipped)')

    # ── 5. map + filter ───────────────────────────────────────────────────────
    stations: list[dict] = []
    skipped = 0
    for detail in details.values():
        s = map_station(detail)
        if s:
            stations.append(s)
        else:
            skipped += 1

    print(f'Mapped {len(stations):,} DC stations with ≥{MIN_STALLS} stalls '
          f'(≥{int(MIN_POWER_KW)} kW), skipped {skipped:,}')

    countries_count: dict[str, int] = {}
    for s in stations:
        c = s['country']
        countries_count[c] = countries_count.get(c, 0) + 1
    print('\nCountries:')
    for c, n in sorted(countries_count.items(), key=lambda x: -x[1]):
        print(f'  {n:4d}  {c}')
    print()

    if args.dry_run:
        print('DRY RUN — not upserting.')
        if stations:
            print('Sample:')
            print(json.dumps(stations[0], indent=2))
        return

    # ── 6. upsert ─────────────────────────────────────────────────────────────
    total = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        upsert_batch(supa_url, supa_key, stations[i: i + BATCH_SIZE])
        inserted += len(stations[i: i + BATCH_SIZE])
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} Shell Recharge stations upserted to Supabase.')


if __name__ == '__main__':
    main()
