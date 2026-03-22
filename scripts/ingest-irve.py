#!/usr/bin/env python3
"""
France IRVE (Infrastructures de Recharge pour Véhicules Électriques) ingestion.

Downloads the consolidated national IRVE dataset from data.gouv.fr and upserts
DC fast-charge stations (≥50 kW, CCS/CHAdeMO) into the Supabase `stations` table.

The IRVE dataset is one row per charging point (PDC). This script groups rows by
station ID, computes max power and stall counts per station, then upserts.

License: Open License 1.0 (Licence Ouverte) — free use, attribution required.
Source: https://transport.data.gouv.fr/datasets/base-nationale-des-irve-*

Usage:
  python3 scripts/ingest-irve.py              # download fresh data
  python3 scripts/ingest-irve.py --input /tmp/irve.csv  # use cached local file
  python3 scripts/ingest-irve.py --min-kw 100
  python3 scripts/ingest-irve.py --dry-run

Credentials read from env vars or worker/.dev.vars:
  SUPABASE_URL              — Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
"""

import argparse
import csv
import io
import os
import sys
import urllib.error
import urllib.request

# Consolidated national IRVE file (one row per charging point)
IRVE_URL = 'https://www.data.gouv.fr/api/1/datasets/r/eb76d20a-8501-400e-b336-d85724de5435'

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
    url = (os.environ.get('SUPABASE_URL', '') or dev_vars.get('SUPABASE_URL', '')).rstrip('/')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '') or dev_vars.get('SUPABASE_SERVICE_ROLE_KEY', '')
    if not url or not key:
        print('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not found.', file=sys.stderr)
        sys.exit(1)
    return url, key


# ── IRVE download ─────────────────────────────────────────────────────────────

def download_irve(url: str) -> list[dict]:
    """Download and parse the IRVE CSV, following redirects."""
    print(f'Downloading IRVE data … (this may take a moment, file is ~140 MB)')
    req = urllib.request.Request(url, headers={'User-Agent': 'FreewayCharge/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        print(f'ERROR: download failed (HTTP {e.code})', file=sys.stderr)
        sys.exit(1)

    print(f'Downloaded {len(raw) / 1_048_576:.1f} MB — parsing CSV …')
    reader = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw), encoding='utf-8-sig'))
    return list(reader)


def load_local(path: str) -> list[dict]:
    print(f'Loading local file: {path}')
    with open(path, encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


# ── mapping ───────────────────────────────────────────────────────────────────

def build_stations(rows: list[dict], min_kw: float) -> list[dict]:
    """
    Group charging-point rows by station ID. Each row is one PDC (point de charge).
    Returns station-level dicts filtered to DC fast-charge only.
    """
    import json as _json

    # Intermediate grouped data
    grouped: dict[str, dict] = {}

    for r in rows:
        try:
            power = float(r.get('puissance_nominale') or 0)
        except (ValueError, TypeError):
            power = 0.0

        has_ccs     = r.get('prise_type_combo_ccs', '').strip().lower() == 'true'
        has_chademo = r.get('prise_type_chademo', '').strip().lower() == 'true'
        is_dc       = has_ccs or has_chademo

        if not is_dc or power < min_kw or power > MAX_POWER_KW:
            continue

        sid = (r.get('id_station_itinerance') or r.get('id_station_local') or '').strip()
        if not sid:
            continue

        try:
            lat = float(r.get('consolidated_latitude') or 0)
            lng = float(r.get('consolidated_longitude') or 0)
        except (ValueError, TypeError):
            continue
        if not lat or not lng:
            continue

        if sid not in grouped:
            # Prefer nom_enseigne (brand) as operator display name
            operator = (r.get('nom_enseigne') or r.get('nom_operateur') or '').strip() or None
            name     = (r.get('nom_station') or operator or sid).strip()
            address  = (r.get('adresse_station') or '').strip() or None

            grouped[sid] = {
                'id':           f'irve:{sid}',
                'name':         name,
                'operator':     operator,
                'lat':          lat,
                'lng':          lng,
                'max_power_kw': 0,
                'stalls':       0,
                'ccs_stalls':   0,
                'chademo_stalls': 0,
                'address':      address,
                'country':      'FR',
                'source':       'irve',
            }

        s = grouped[sid]
        s['max_power_kw'] = max(s['max_power_kw'], power)
        s['stalls'] += 1
        if has_ccs:     s['ccs_stalls']     += 1
        if has_chademo: s['chademo_stalls']  += 1

    # Build final station objects
    stations: list[dict] = []
    for s in grouped.values():
        connectors: list[dict] = []
        if s['ccs_stalls'] > 0:
            connectors.append({'type': 'CCS (Type 2)', 'powerKw': int(s['max_power_kw'])})
        if s['chademo_stalls'] > 0:
            connectors.append({'type': 'CHAdeMO', 'powerKw': int(s['max_power_kw'])})

        stations.append({
            'id':           s['id'],
            'name':         s['name'],
            'operator':     s['operator'],
            'lat':          s['lat'],
            'lng':          s['lng'],
            'max_power_kw': min(int(s['max_power_kw']), MAX_POWER_KW),
            'total_stalls': s['stalls'],
            'connectors':   connectors,
            'address':      s['address'],
            'country':      'FR',
            'source':       'irve',
        })

    return stations


# ── Supabase upsert ───────────────────────────────────────────────────────────

def upsert_batch(supabase_url: str, key: str, batch: list[dict]) -> None:
    import json as _json
    payload = _json.dumps(batch).encode('utf-8')
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
    import json as _json
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--input',  help='Path to a local irve.csv (skips download)')
    parser.add_argument('--min-kw', type=float, default=DEFAULT_MIN_KW,
                        help=f'Minimum power in kW (default {DEFAULT_MIN_KW})')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print mapped stations without upserting')
    args = parser.parse_args()

    supa_url, supa_key = get_credentials()
    print(f'Supabase: {supa_url}')

    # ── load data ─────────────────────────────────────────────────────────────
    if args.input:
        rows = load_local(args.input)
    else:
        rows = download_irve(IRVE_URL)
    print(f'Loaded {len(rows):,} charging-point rows')

    # ── group and filter ──────────────────────────────────────────────────────
    stations = build_stations(rows, args.min_kw)
    print(f'Mapped to {len(stations):,} DC fast-charge stations (≥{args.min_kw:.0f} kW)')

    # operator summary
    ops: dict[str, int] = {}
    for s in stations:
        op = s.get('operator') or 'Unknown'
        ops[op] = ops.get(op, 0) + 1
    print('\nTop 20 operators:')
    for op, n in sorted(ops.items(), key=lambda x: -x[1])[:20]:
        print(f'  {n:4d}  {op}')
    print()

    if args.dry_run:
        print('DRY RUN — not upserting to Supabase.')
        if stations:
            print('Sample station:')
            print(_json.dumps(stations[0], indent=2))
        return

    # ── upsert ────────────────────────────────────────────────────────────────
    total    = len(stations)
    inserted = 0
    for i in range(0, total, BATCH_SIZE):
        batch = stations[i : i + BATCH_SIZE]
        upsert_batch(supa_url, supa_key, batch)
        inserted += len(batch)
        print(f'  Upserted {inserted:,}/{total:,} ({inserted/total*100:.0f}%)',
              end='\r', flush=True)

    print(f'\nDone. {total:,} IRVE stations upserted to Supabase.')


if __name__ == '__main__':
    main()
