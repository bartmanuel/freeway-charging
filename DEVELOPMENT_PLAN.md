# Freeway Charge — Development Plan

## Existing Codebase Assessment

The current prototype validates that ChargeTrip + Google Maps work, but needs a fundamental architectural shift:
- **Problem**: ChargeTrip's `newRoute` mutation *modifies* the route to include charging stops — directly contradicts "route is sacred"
- **Solution**: Decouple routing (Google Routes API) from charging (independent corridor search)
- Everything in `App.js` is monolithic (561 lines), uses legacy Apollo v2, and has hardcoded API keys
- **Reusable**: The `GETSTATION` GraphQL query structure, polyline decoding pattern, and OpenChargeMap API patterns from the scratchpad

---

## Phase 0 — Research & Validation ✅ Complete

**Goal**: Confirm data quality and optimal API combination before writing production code.
Full findings: see `PHASE_0_FINDINGS.md`

### Key Research Tasks

| Task | Result |
|---|---|
| Google Routes API v2 | ✅ $0.005/request after 10K free/mo. Polyline: 200–600 pts for 500+ km, 5 decimal precision. Cache TTL up to 30 days. |
| Station data sources | ✅ OCM `polyline=` param works (3 km buffer). ChargeTrip `stationAround` is point+radius only — not useful for corridor queries. |
| Station density check | ✅ A2 Amsterdam→Eindhoven: 13.6 stations/100 km at levelid=3. Target was 3–4. |
| Competitive gap | ✅ Confirmed. No app does route-preserving station overlay. |

### Open Questions — Resolved
1. ~~Does ChargeTrip offer corridor/area search?~~ → **No. `stationAround` is point+radius only. Use OCM for corridor queries.**
2. ~~Are Tesla Supercharger locations reliably present in OpenChargeMap?~~ → **Yes, reasonably complete for NL/DE. Community-sourced so may lag on new openings.**
3. ~~Is there an affordable OCPI aggregator for real-time Western EU availability?~~ → **No self-serve tier. Eco-Movement is the commercial option (custom pricing). Defer to Phase 2.**

---

## Phase 1 — Core MVP (4-6 weeks)

**Goal**: User enters origin/destination, sees their route on a map + a scrollable list of high-capacity stations along it (static data, no live availability).

### Architecture Shift

| Aspect | Current | Target |
|---|---|---|
| Route source | ChargeTrip (modifies route) | Google Routes API v2 (route preserved) |
| Apollo | v2 split packages | Drop in favor of React Query + fetch |
| Components | Monolithic `App.js` | Feature-based folders |
| Map library | `google-maps-react` (unmaintained) | `@vis.gl/react-google-maps` |
| Build tool | CRA | Vite + TypeScript |
| API keys | Hardcoded | `.env.local` |

### Data Flow
```
User Input → Google Routes API → Polyline → Corridor Search (client-side) → Station Filter/Ranker → UI
```

### Key Components

| Component | Description | Effort |
|---|---|---|
| **RouteInputPanel** | Origin/dest with Google Places Autocomplete | M |
| **RouteService** | Calls Routes API, decodes polyline | M |
| **CorridorSearchService** | Finds stations within 3 km of route polyline using point-to-segment distance | L |
| **StationRanker** | Scores by power (150+ kW), stalls (8+ preferred), operator, detour distance | S |
| **StationListPanel** | Scrollable cards with operator logo, distance, stall count, detour | M |
| **MapView** | Route polyline + station markers with InfoWindows | M |

### Station Selection Algorithm

1. **Subsample** polyline to one point every 3 km
2. **R-tree query** (`rbush` library) for stations within corridor
3. **Precise distance** computation via perpendicular projection onto polyline segments
4. **Distance-along-route** = sum of segment lengths from origin to projection point (gives list ordering)
5. **Score & select** — if fewer than 3 qualify, progressively relax criteria

### Station Data Strategy (MVP)

Pre-built static JSON from OpenChargeMap filtered to NL/DE/BE/FR, 150+ kW, levelid=3 (DC rapid). Bundled with the app. Refreshed weekly manually. Note: stall count is often missing in OCM data — treat as optional in the filter, not a hard requirement.

### Data Model

- **Route**: id, origin, destination, polyline, decodedPath, distance, duration
- **Station**: id, name, operator, lat/lng, maxPowerKw, totalStalls, connectors[], address, country
- **StationOnRoute**: station, distanceAlongRoute, detourMeters, score

### Folder Structure

```
src/
  components/
    MapView/
    StationList/
    RouteInput/
  services/
    routeService.ts
    corridorSearch.ts
    stationRanker.ts
  data/
    stations-cache.json
  hooks/
    useRoute.ts
    useStations.ts
  types/
    route.ts
    station.ts
  App.tsx
  main.tsx
```

---

## Phase 2 — Live Data Integration (6-8 weeks)

**Goal**: Stations show real-time availability (X of Y free), occupancy trends, auto-refresh every 30-60s.

### Architecture: Backend Required

- **Runtime**: Cloudflare Workers (edge, no cold starts, EU-proximate)
- **Database**: Supabase (PostgreSQL) for station metadata + Upstash Redis (30s TTL) for availability cache
- **Pattern**: Backend acts as caching proxy — polls availability provider/OpenChargeMap, clients poll backend
- **Availability source**: ChargeTrip for station detail queries only (not corridor search). For broader real-time coverage, evaluate Eco-Movement (OCPI-based, custom pricing) — confirm commercial terms before Phase 2 kick-off

### Backend Endpoints

- `POST /api/route` — proxy to Google Routes, cache by origin/dest hash
- `POST /api/stations/corridor` — corridor search + live availability merged
- `GET /api/stations/:id/trends` — occupancy trends (hourly averages per day-of-week)

### Key Components

| Component | Description | Effort |
|---|---|---|
| **StationAvailabilityService** | Checks Redis cache, falls back to ChargeTrip `station` query | L |
| **CorridorSearchAPI** | Server-side corridor search with PostGIS spatial index | M |
| **useStationPolling hook** | Client-side 30-60s polling with visibility API check | S |
| **AvailabilityBadge** | Green/yellow/red indicator, "X of Y free" | S |
| **OccupancyTrendChart** | Sparkline showing typical availability next few hours | M |
| **TrendAggregationWorker** | Daily cron computing hourly averages from raw readings | M |

### Data Model Additions

```
StationAvailability {
  stationId: string
  timestamp: ISO8601
  chargers: ChargerStatus[]
  source: 'chargetrip' | 'ocm' | 'ocpi'
}

ChargerStatus {
  connectorType: string
  powerKw: number
  total: number
  free: number
  busy: number
  unknown: number
  error: number
}

OccupancyTrend {
  stationId: string
  dayOfWeek: 0-6
  hour: 0-23
  avgFreeRatio: number (0.0 - 1.0)
  sampleCount: number
}
```

### Reusable from Prototype

The `GETSTATION` query (App.js:63-232) already requests `chargers { status { free, busy, unknown, error } }` — exactly the fields needed.

---

## Phase 3 — Driving Mode (6-8 weeks)

**Goal**: GPS-tracked driving experience with auto-updating distances, prefetching, and offline support.

### Key Design Decisions

- **GPS**: `navigator.geolocation.watchPosition` with snap-to-route smoothing
- **Three refresh zones**: Immediate (0-50 km, 30s), Upcoming (50-150 km, 120s), Far (150-300 km, 300s)
- **Offline**: Service worker caches route + station metadata at trip start

### Key Components

| Component | Description | Effort |
|---|---|---|
| **GPSTracker** | Wraps watchPosition, snap-to-route, distance-along-route computation | M |
| **DrivingModeView** | Auto-following map, glanceable UI (large fonts, high contrast) | L |
| **PrefetchScheduler** | Manages zone-based refresh timers | M |
| **RouteProgressBar** | Horizontal bar showing position + station dots | S |
| **ServiceWorker** | Offline caching with Workbox, "offline" indicator | M |

### Safety UX

- Large, glanceable elements — no small text while driving
- Route deviation detection (>500m from polyline → warning)
- Prepare data flow for future voice announcements

---

## Phase 4 — Community & Caching (5-7 weeks)

**Goal**: User feedback loop to build a curated freeway station database that improves over time.

### Key Components

- **UserService**: Anonymous device ID by default, optional email/OAuth upgrade
- **StationFeedbackService**: Thumbs up/down per visit + optional structured reports
- **QualityScoreEngine**: 0-100 score from uptime + user satisfaction + report consistency
- **StationCurationPipeline**: Nightly OpenChargeMap sync merged with user corrections

### Quality Score Formula

- Automated uptime (from availability polling)
- User satisfaction (thumbs up/down ratio, reputation-weighted)
- Staleness penalty (no reports in 90 days = score decays)
- Score influences StationRanker ordering

### Data Model Additions

```
User {
  id: string (UUID)
  email: string | null
  createdAt: ISO8601
  contributionCount: number
  reputationScore: number
}

StationFeedback {
  id: string
  stationId: string
  userId: string
  timestamp: ISO8601
  rating: 'positive' | 'negative'
  workingStalls: number | null
  queueLength: number | null
  accessIssue: string | null
  comment: string | null
}

StationQuality {
  stationId: string
  qualityScore: number (0-100)
  uptimePercent: number
  userRating: number (0-5)
  reportCount: number
  lastReportAt: ISO8601
  lastVerifiedAt: ISO8601
}
```

---

## Phase 5 — Polish & Distribution (4-6 weeks)

**Goal**: Production-ready PWA + optional native wrapper via Capacitor.

- PWA manifest, Workbox caching, install prompt
- Capacitor for iOS/Android (background GPS, push notifications)
- 3-screen onboarding flow
- Privacy-respecting analytics (Plausible/Umami)
- Sentry error tracking, React error boundaries
- Code splitting, list virtualization, marker clustering, Lighthouse 90+

---

## Cross-Cutting Concerns

### API Cost Estimates

| Scale | Google Routes | Places Autocomplete | Maps JS Loads | ChargeTrip | **Total** |
|---|---|---|---|---|---|
| 100 users | $15-30/mo | $8/mo | $21/mo | $0 | **~$50-75/mo** |
| 1,000 users | $150-300/mo | $85/mo | $210/mo | $0-50/mo | **~$450-650/mo** |
| 10,000 users | $1,500-3,000/mo | $850/mo | $2,100/mo | $50-500/mo | **~$4,500-6,500/mo** |

**Major cost saver**: Replace Google Maps JS with MapLibre + OpenStreetMap tiles → saves $2,100/mo at 10K users.

### Infrastructure

| Component | Choice | Monthly Cost (10K users) |
|---|---|---|
| Frontend | Vercel / Cloudflare Pages | $0 |
| Backend API | Cloudflare Workers | $0-25 |
| Database | Supabase free tier | $0-25 |
| Redis cache | Upstash | $0-10 |

### Caching Strategy

| Data | TTL | Location |
|---|---|---|
| Station metadata | 24h | DB + CDN |
| Route polylines | 30 days | Redis/KV |
| Live availability | 30-60s | Redis |
| Occupancy trends | 24h | DB |

### Legal / GDPR

- **User location**: PII — minimal collection, anonymous by default, data export/delete endpoints required
- **Google Maps ToS**: Must display Google logo, route cache TTL up to 30 days (confirmed)
- **OpenChargeMap**: ODbL license — attribution required, derivative DB must also be open
- **ChargeTrip ToS**: Check free tier limitations on commercial use
- **App store**: Clear permission dialogs explaining GPS usage

### Migration from Prototype

- **Start fresh** with Vite + TypeScript (don't incrementally refactor)
- **Reuse**: `GETSTATION` query structure, polyline decode pattern, OpenChargeMap API patterns from scratchpad
- **Drop**: `NEWROUTE` mutation, `CARLISTALL` query, class components, `google-maps-react`, old Apollo packages
- **Move**: All API keys to `.env.local`
