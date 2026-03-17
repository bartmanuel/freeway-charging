# Freeway Charge (EVStationFinder)

A web app that helps EV drivers find high-capacity charging stations along their route — without modifying the route. See @DEVELOPMENT_PLAN.md for the full roadmap and @PHASE_0_FINDINGS.md for completed research.

## Current Status
The existing code in `src/` is a **prototype only** — it validates that ChargeTrip + Google Maps work. The production app is a **fresh rewrite** (Vite + TypeScript). Do not incrementally refactor the prototype; start clean per the dev plan.

## Commands
- `npm start` — start the dev server (http://localhost:3000)
- `npm test` — run tests
- `npm run build` — production build

## Target Stack (production rewrite)
- **Vite + TypeScript** — replaces Create React App
- **React** (functional components + hooks only)
- **React Query + fetch** — replaces Apollo Client
- **Google Routes API v2** — routing (preserves user's route)
- **`@vis.gl/react-google-maps`** — replaces unmaintained `google-maps-react`
- **OpenChargeMap API** — station data (corridor search via `polyline=` + `minpowerkw=200`)
- **ChargeTrip API** — station detail/availability queries only (not routing)
- **rbush** — R-tree for client-side corridor spatial search

## Prototype Stack (src/ — reference only, being replaced)
- React + Apollo Client v2 (legacy split packages)
- `google-maps-react`
- ChargeTrip GraphQL for routing (hardcoded Hamburg → Rotterdam)

## Project Structure
```
src/
  App.js      — all GraphQL queries/mutations, React components, map logic (~561 lines)
  index.js    — Apollo Client setup, API auth headers, React entry point
  App.css     — component styles (currently empty)
  index.css   — global styles
```

## Key Architecture
- All logic lives in `src/App.js` — it's a monolithic file with GraphQL definitions and components together
- **Data flow:** `CreateRoute` mutation → 5s delay (server processing) → `GetRoute` query → `StationCoords` per leg → render on map
- Components communicate via callback props and parent state (no Redux/context)
- Map default center: Central Europe (51°N, 8°E)

## GraphQL Operations (in App.js)
| Name | Type | Purpose |
|---|---|---|
| `NEWROUTE` | Mutation | Create a new route (hardcoded Hamburg → Rotterdam) |
| `CARLISTALL` | Query | List available EV models |
| `GETSTATION` | Query | Fetch detailed station info (connectors, operator, etc.) |
| `GETROUTE` | Query | Retrieve a planned route with legs and charging stops |

## API Credentials
- ChargeTrip `x-client-id` and `x-app-id` are hardcoded in `src/index.js`
- **Do not commit real credentials to version control**

## What to Reuse from Prototype
- `GETSTATION` GraphQL query structure (App.js:63-232) — already requests the right availability fields
- Polyline decode pattern
- OpenChargeMap API patterns from `Scratchpad_Statements.txt`

## What to Drop
- `NEWROUTE` mutation (ChargeTrip routing modifies the route — by design we don't want that)
- `CARLISTALL` query
- Class components
- `google-maps-react`, legacy Apollo v2 packages

## Target Folder Structure (Phase 1)
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
