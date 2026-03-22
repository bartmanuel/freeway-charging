#!/usr/bin/env python3
"""
Tesla Supercharger ingestion into Supabase via supercharge.info.

Fetches all sites from the supercharge.info public domain API and upserts
open Supercharger locations into the Supabase `stations` table.

Data is explicitly public domain — no API key or attribution required.
Source: https://supercharge.info  (GitHub: supercharge-info/supercharge.info-api)

Usage:
  python3 scripts/ingest-tesla.py              # all open sites globally
  python3 scripts/ingest-tesla.py --region eu  # Europe only
  python3 scripts/ingest-tesla.py --dry-run    # print without upserting

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

SUPERCHARGE_URL = 'https://supercharge.info/service/supercharge/allSites'

# Statuses considered "open" — skip PLAN, CONSTRUCTION, PERMIT, VOTING, CLOSED_*
OPEN_STATUSES = {'OPEN', 'EXPANDING', 'CLOSED_TEMP'}

# Country name → ISO 3166-1 alpha-2
COUNTRY_CODES: dict[str, str] = {
    'Albania': 'AL', 'Austria': 'AT', 'Belgium': 'BE', 'Bosnia and Herzegovina': 'BA',
    'Bulgaria': 'BG', 'Croatia': 'HR', 'Cyprus': 'CY', 'Czech Republic': 'CZ',
    'Denmark': 'DK', 'Estonia': 'EE', 'Finland': 'FI', 'France': 'FR',
    'Germany': 'DE', 'Greece': 'GR', 'Hungary': 'HU', 'Iceland': 'IS',
    'Ireland': 'IE', 'Italy': 'IT', 'Latvia': 'LV', 'Lithuania': 'LT',
    'Luxembourg': 'LU', 'Malta': 'MT', 'Montenegro': 'ME', 'Netherlands': 'NL',
    'North Macedonia': 'MK', 'Norway': 'NO', 'Poland': 'PL', 'Portugal': 'PT',
    'Romania': 'RO', 'Serbia': 'RS', 'Slovakia': 'SK', 'Slovenia': 'SI',
    'Spain': 'ES', 'Sweden': 'SE', 'Switzerland': 'CH', 'Turkey': 'TR',
    'Ukraine': 'UA', 'United Kingdom': 'GB',
    # Non-EU but commonly driven
    'Morocco': 'MA', 'Israel': 'IL',
    # Americas
    'USA': 'US', 'Canada': 'CA', 'Mexico': 'MX',
    # Asia-Pacific
    'Australia': 'AU', 'New Zealand': 'NZ', 'Japan': 'JP',
    'South Korea': 'KR', 'China': 'CN',
}

EU_REGIONS = {'Europe'}

DEFAULT_MIN_KW = 50
MAX_POWER_KW   = 1000
BATCH_SIZE     = 200


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
    url = os.environ.get('SUPABASE_URL', '') or dev_vars.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '') or dev_vars.get('SUPABASE_SERVICE_ROLE_KEY', '')
    url = url.rstrip('/')
    if not url or not key:
        print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not found.', file=sys.stderr)
        sys.exit(1)
    return url, key


# ── supercharge.info fetch ────────────────────────────────────────────────────

def fetch_sites() -> list[dict]:
    print(f'Fetching {SUPERCHARGE_URL} …')
    req = urllib.request.Request(
        SUPERCHARGE_URL,
        headers={'User-Agent': 'FreewayCharge/1.0 (EV route planner; non-commercial)'},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f'ERROR: fetch failed (HTTP {e.code}): {e.read().decode()[:200]}', file=sys.stderr)
        sys.exit(1)


# ── mapping ───────────────────────────────────────────────────────────────────

def map_site(site: dict, min_kw: float) -> dict | None:
    """Map a supercharge.info site to a Supabase station row."""
    if site.get('status') not in OPEN_STATUSES:
        return None

    gps = site.get('gps') or {}
    try:
        lat = float(gps['latitude'])
        lng = float(gps['longitude'])
    except (KeyError, TypeError, ValueError):
        return None

    power_kw = float(site.get('powerKilowatt') or 0)
    if power_kw < min_kw or power_kw > MAX_POWER_KW:
        return None

    plugs = site.get('plugs') or {}
    connectors: list[dict] = []
    if plugs.get('ccs2', 0) > 0:
        connectors.append({'type': 'CCS (Type 2)', 'powerKw': int(power_kw)})
    if plugs.get('nacs', 0) > 0 or plugs.get('tpc', 0) > 0:
        connectors.append({'type': 'Tesla', 'powerKw': int(power_kw)})
    # Fallback: if no specific plug data, add generic Tesla connector
    if not connectors:
        connectors.append({'type': 'Tesla', 'powerKw': int(power_kw)})

    addr = site.get('address') or {}
    country_name = addr.get('country') or ''
    country_code = COUNTRY_CODES.get(country_name, country_name[:2].upper() if country_name else 'XX')

    address = ', '.join(
        p for p in [addr.get('street'), addr.get('city')] if p
    ) or None

    stall_count = site.get('stallCount') or None

    return {
        'id':           f"tesla:{site['id']}",
        'name':         site.get('name') or 'Tesla Supercharger',
        'operator':     'Tesla',
        'lat':          lat,
        'lng':          lng,
        'max_power_kw': min(int(power_kw), MAX_POWER_KW),
        'total_stalls': stall_count,
        'connectors':   connectors,
        'address':      address,
        'country':      country_code,
        'source':       'supercharge_info',
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
    parser.add_argument('--region', choices=['eu', 'all'], default='all',
                        help='Filter to EU/Europe region only (default: all)')
    parser.add_argument('--min-kw', type=float, default=DEFAULT_MIN_KW,
                        help=f'Minimum power in kW (default {DEFAULT_MIN_KW})')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print mapped stations without upserting to Supabase')
    args = parser.parse_args()

    supa_url, supa_key = get_credentials()
    print(f'Supabase: {supa_url}')

    raw_sites = fetch_sites()
    print(f'Loaded {len(raw_sites):,} sites from supercharge.info')

    # Optional EU filter
    if args.region == 'eu':
        raw_sites = [s for s in raw_sites if (s.get('address') or {}).get('region') in EU_REGIONS]
        print(f'After EU filter: {len(raw_sites):,} sites')

    # Map and filter
    stations: list[dict] = []
    skipped = 0
    for site in raw_sites:
        station = map_site(site, args.min_kw)
        if station:
            stations.append(station)
        else:
            skipped += 1

    print(f'Mapped to {len(stations):,} stations (≥{args.min_kw:.0f} kW, open), skipped {skipped:,}')

    # Country summary
    countries: dict[str, int] = {}
    for s in stations:
        c = s.get('country') or 'XX'
        countries[c] = countries.get(c, 0) + 1
    print('\nTop countries:')
    for c, n in sorted(countries.items(), key=lambda x: -x[1])[:15]:
        print(f'  {n:5d}  {c}')
    print()

    if args.dry_run:
        print('DRY RUN — not upserting to Supabase.')
        if stations:
            print('Sample station:')
            print(json.dumps(stations[0], indent=2))
        return

    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = stations[i : i + BATCH_SIZE]
        upsert_batch(supa_url, supa_key, batch)
        inserted += len(batch)
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} Tesla Supercharger stations upserted to Supabase.')


if __name__ == '__main__':
    main()
