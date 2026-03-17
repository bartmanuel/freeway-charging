# Phase 0 Research Findings

## 1. OpenChargeMap Corridor Search ✅ Confirmed (with caveats)

### polyline= parameter
- **Works** — confirmed live on A2 Amsterdam → Eindhoven (110 km)
- Returns stations within a configurable buffer (3 km recommended for motorway use)
- Community has reported intermittent failures — implement radius query fallback
- Use `distance=3&distanceunit=KM` alongside the polyline

### minpowerkilowatts= / levelid=
- `levelid=3` is the reliable filter for DC rapid chargers (50 kW+)
- `minpowerkilowatts=` exists but is underdocumented and may be ignored; use as secondary hint
- Sanity-cap max power at ~500 kW — bad data exists (e.g. 501 kW farm shop)

### Data quality observations
- `OperatorInfo` is frequently null — use station name as fallback for operator display
- `NumberOfPoints` (stall count) often missing — treat as optional in the data model
- `PowerKW` on connections sometimes 0 or missing — filter these out

### Tesla Superchargers
- **Present and reasonably complete** on the A2 corridor (Breukelen 28, Bunnik 32, Meerkerk 16, Zaltbommel 16, Eindhoven 24, Best 20)
- Data is community-sourced so may lag behind Tesla's own network for new openings
- Power values may reflect V2 specs even for upgraded V3/V4 sites

### Auth & limits
- API key required (403 without one) — free key at https://openchargemap.org/site/develop/registerkey
- No hard rate limit published; ~300 ms delay between requests is safe
- License: **ODbL** — attribution required, derivative DBs must also be open

---

## 2. Station Density Test — A2 Amsterdam → Eindhoven (110 km) ✅ Passed

| Strategy | Stations found | Per 100 km |
|---|---|---|
| A — polyline= (3 km buffer) | 15 | 13.6 |
| B — radius queries (15 km, 7 waypoints, deduped) | 84 | 76.4 |

**Target was ≥3–4 per 100 km. Both strategies pass comfortably.**

### Recommended approach for MVP
- **Primary**: Strategy A (polyline) — tight corridor, fewer API calls, less client-side filtering needed
- **Fallback**: Strategy B (radius at intervals) — if polyline param fails or returns 0 results
- Strategy B results require client-side distance-to-polyline filtering (the rbush R-tree plan)

### High-quality stations found on A2
Key motorway-grade stations (100 kW+, multiple stalls):
- IONITY De Kroon / De Knoest — 350 kW, Utrecht area
- Fastned Ravensewetering — 350 kW, Utrecht
- Fastned Jutphaas — 350 kW, south of Utrecht
- Fastned Eigenblok / Molenkamp — 175 kW, Zaltbommel area
- IONITY Best — 350 kW, near Eindhoven
- Tesla Supercharger Best — 250 kW, 20 stalls
- Multiple Fastned 175 kW sites throughout

---

## 3. ChargeTrip API ⚠️ Point + radius only

- `stationAround` query exists — takes a **GeoJSON point + radius**, not a polyline
- To do corridor search: query multiple points along route (extra API calls per route)
- Supports power kW and amenities filters
- "Stations along route" example in their docs is tied to ChargeTrip routing (modifies route)
- **Free tier / commercial use**: not publicly documented — needs direct inquiry before Phase 2

---

## 4. Google Routes API v2 ✅ Solid choice

- Endpoint: `POST https://routes.googleapis.com/directions/v2:computeRoutes`
- Polyline encoding: `ENCODED_POLYLINE` (5 decimal places) or `GEO_JSON_LINESTRING`
- `polylineQuality`: `HIGH_QUALITY` (200–600 points for 500+ km) or `OVERVIEW` (minimal)
- Use field mask: `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`
- Max 25 waypoints per request

### Pricing
| Tier | Cost per 1,000 requests |
|---|---|
| 0–10,000/month | **Free** |
| 10K–100K | $5.00 |
| 100K–500K | $4.00 |
| 500K–1M | $3.00 |

### Terms of service
- Route data may be cached for **up to 30 days** (dev plan had 24h — this is better)
- Must display Google attribution

### EV routing fields
- `ev_params` / `evOptions` + `extraComputations: ["FUEL_CONSUMPTION"]` exist in beta/preview
- Not relevant to Freeway Charge (we don't modify routes) but worth monitoring for GA

---

## 5. Competitive Gap ✅ Confirmed

No existing app takes the "overlay stations on your existing route without changing it" approach:

| App | Approach |
|---|---|
| ABRP | Recalculates route around charging stops |
| Google Maps | Recalculates route around charging stops |
| PlugShare | Shows stations on map, not route-preserving |
| ChargeTrip | Recalculates route around charging stops |

Current EV driver workaround: use ABRP + PlugShare + Google Maps as 3 separate tools.
**This 3-tool friction is the gap Freeway Charge addresses.**

---

## 6. Real-time Availability (OCPI) ⚠️ Phase 2 problem

- **Eco-Movement** is the leading commercial option — OCPI-based, covers all of Western Europe, used by Google/Tesla/ABRP/HERE. Pricing is custom/negotiated (not self-serve)
- EU AFIR regulations (April 2025) now legally require all public charger operators to publish data via standardised APIs — improving availability over time
- Other options: Gireve, Hubject, e-clearing.net
- **No affordable self-serve tier found** — defer to Phase 2 and budget for a commercial agreement

---

## Open Questions (still unresolved)

1. **ChargeTrip free tier commercial use** — needs direct inquiry before Phase 2 live data work
2. **Eco-Movement pricing** — contact them when approaching Phase 2
3. **Google Routes API v2 EV fields GA status** — check before Phase 1 kick-off (not needed but good to know)

---

## Test Script

`test-ocm-corridor.py` — run to re-validate station density on A2:
```
OCM_API_KEY=your_key python3 test-ocm-corridor.py
```
OCM API key stored in `Scratchpad_Statements.txt`.
