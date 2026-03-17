"""
Phase 0 Research: OpenChargeMap station density test

Tests two query strategies along the A2 motorway (Amsterdam → Eindhoven, ~110 km):
  Strategy A: Single request using OCM's polyline= parameter
  Strategy B: Multiple radius queries at ~20 km intervals (reliable fallback)

Usage:
    python3 test-ocm-corridor.py
    OCM_API_KEY=your_key python3 test-ocm-corridor.py

Get a free API key at: https://openchargemap.org/site/develop/registerkey
"""

import os
import json
import time
import urllib.request
import urllib.parse

API_KEY = os.environ.get('OCM_API_KEY', '')
BASE_URL = 'https://api.openchargemap.io/v3/poi/'

# A2 motorway waypoints roughly every 20 km
# Amsterdam → Abcoude → Utrecht → Vianen → 's-Hertogenbosch → Eindhoven
A2_WAYPOINTS = [
    {'lat': 52.3676, 'lng': 4.9041, 'name': 'Amsterdam (start)'},
    {'lat': 52.2717, 'lng': 4.9779, 'name': 'Abcoude (~20 km)'},
    {'lat': 52.0907, 'lng': 5.1214, 'name': 'Utrecht (~40 km)'},
    {'lat': 51.9875, 'lng': 5.0992, 'name': 'Vianen (~55 km)'},
    {'lat': 51.8183, 'lng': 5.2497, 'name': 'Zaltbommel (~75 km)'},
    {'lat': 51.6989, 'lng': 5.3283, 'name': 'Boxtel (~90 km)'},
    {'lat': 51.4416, 'lng': 5.4697, 'name': 'Eindhoven (end)'},
]

ROUTE_LENGTH_KM = 110

# Filters — target: high-power DC rapid chargers
FILTERS = {
    'levelid': 3,               # Level 3 = DC rapid (50 kW+)
    'minpowerkilowatts': 50,    # Additional kW filter (may be ignored if unsupported)
    'maxresults': 500,
    'compact': 'true',
    'verbose': 'false',
}

# ── Polyline encoding ──────────────────────────────────────────────────────────

def encode_value(value):
    v = ~(value << 1) if value < 0 else value << 1
    output = ''
    while v >= 0x20:
        output += chr((0x20 | (v & 0x1f)) + 63)
        v >>= 5
    output += chr(v + 63)
    return output

def encode_polyline(points):
    output = ''
    prev_lat = prev_lng = 0
    for p in points:
        lat_e5 = round(p['lat'] * 1e5)
        lng_e5 = round(p['lng'] * 1e5)
        output += encode_value(lat_e5 - prev_lat)
        output += encode_value(lng_e5 - prev_lng)
        prev_lat, prev_lng = lat_e5, lng_e5
    return output

# ── API helpers ────────────────────────────────────────────────────────────────

def query_ocm(params):
    all_params = {**FILTERS, **params}
    if API_KEY:
        all_params['key'] = API_KEY
    url = BASE_URL + '?' + urllib.parse.urlencode(all_params)
    req = urllib.request.Request(url, headers={'User-Agent': 'FreewayCharge-PhaseZero/1.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())

def dedupe_by_id(stations):
    seen = set()
    unique = []
    for s in stations:
        if s['ID'] not in seen:
            seen.add(s['ID'])
            unique.append(s)
    return unique

def format_station(s):
    name = (s.get('AddressInfo') or {}).get('Title', 'Unknown')
    operator = (s.get('OperatorInfo') or {}).get('Title', 'Unknown operator')
    connections = s.get('Connections') or []
    max_kw = max((c.get('PowerKW') or 0 for c in connections), default='?')
    stalls = s.get('NumberOfPoints', '?')
    lat = (s.get('AddressInfo') or {}).get('Latitude', '')
    lng = (s.get('AddressInfo') or {}).get('Longitude', '')
    lat_str = f'{lat:.4f}' if isinstance(lat, float) else str(lat)
    lng_str = f'{lng:.4f}' if isinstance(lng, float) else str(lng)
    return f'  • {name} | {operator} | {max_kw} kW max | {stalls} stalls | ({lat_str}, {lng_str})'

# ── Strategy A: Polyline parameter ────────────────────────────────────────────

def strategy_a_polyline():
    print('\n━━━ Strategy A: OCM polyline= parameter ━━━')
    polyline = encode_polyline(A2_WAYPOINTS)
    print(f'Encoded polyline ({len(polyline)} chars): {polyline[:40]}…')

    try:
        stations = query_ocm({
            'polyline': polyline,
            'distance': 3,
            'distanceunit': 'KM',
        })
        unique = dedupe_by_id(stations)
        print(f'\nResult: {len(unique)} unique stations within 3 km of A2\n')
        for s in unique:
            print(format_station(s))
        return unique
    except Exception as e:
        print(f'FAILED: {e}')
        return None

# ── Strategy B: Multiple radius queries ───────────────────────────────────────

def strategy_b_multi_radius():
    print('\n━━━ Strategy B: Multiple radius queries (20 km intervals) ━━━')
    all_stations = []

    for wp in A2_WAYPOINTS:
        print(f"  Querying {wp['name']}… ", end='', flush=True)
        try:
            stations = query_ocm({
                'latitude': wp['lat'],
                'longitude': wp['lng'],
                'distance': 15,
                'distanceunit': 'KM',
            })
            print(f'{len(stations)} stations')
            all_stations.extend(stations)
            time.sleep(0.3)  # be polite to the API
        except Exception as e:
            print(f'FAILED: {e}')

    unique = dedupe_by_id(all_stations)
    print(f'\nResult: {len(unique)} unique stations after dedup\n')
    for s in unique:
        print(format_station(s))
    return unique

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print('OpenChargeMap Corridor Density Test')
    print(f'Route: Amsterdam → Eindhoven (A2, ~{ROUTE_LENGTH_KM} km)')
    print(f'Filter: Level 3 DC rapid, ≥{FILTERS["minpowerkilowatts"]} kW')
    print(f'API key: {"provided ✓" if API_KEY else "not set (rate-limited)"}')

    result_a = strategy_a_polyline()
    result_b = strategy_b_multi_radius()

    print('\n━━━ Summary ━━━')

    if result_a is not None:
        density_a = len(result_a) / ROUTE_LENGTH_KM * 100
        print(f'Strategy A (polyline):       {len(result_a)} stations → {density_a:.1f} per 100 km')
    else:
        print('Strategy A (polyline):       FAILED (parameter not supported or broken)')

    if result_b is not None:
        density_b = len(result_b) / ROUTE_LENGTH_KM * 100
        print(f'Strategy B (radius queries): {len(result_b)} stations → {density_b:.1f} per 100 km')

    print(f'\nTarget from dev plan: ≥3–4 stations per 100 km')

    if result_b is not None:
        density = len(result_b) / ROUTE_LENGTH_KM * 100
        if density >= 3:
            print('✓ Station density is sufficient for MVP')
        else:
            print('✗ Station density is LOW — consider relaxing filters (lower kW, include Level 2)')

if __name__ == '__main__':
    main()
