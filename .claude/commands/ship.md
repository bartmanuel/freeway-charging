Run the full test → commit → deploy pipeline for Freeway Charge.

## Steps

Work through these steps in order. Stop and report if any step fails — do not proceed to the next step.

### 1. Type check + build
```
cd app && npm run build
```
Fix any TypeScript or build errors before continuing.

Also typecheck the worker:
```
cd worker && npm run typecheck
```

### 2. Infrastructure checks
```
cd app && npm test -- tests/infra.spec.ts
```
This runs 3 API-only tests (no browser) verifying:
- Cloudflare Worker is up (`/api/health`)
- Supabase and Upstash are reachable (`/api/health?deep=true`)
- Corridor endpoint responds (Supabase query path)

If any infra test fails, stop and investigate — the services may be down or credentials may have changed.

### 3. Smoke tests (Playwright / Chromium)
```
cd app && npm test -- tests/smoke.spec.ts
```
This launches a real Chromium instance against the local dev server and runs 4 smoke tests:
- Page loads with title and form
- Google Map renders
- Route search (Amsterdam → Eindhoven) returns stations
- Clicking a station selects it

If any test fails, investigate and fix before continuing. The dev server starts automatically via the `webServer` config in `playwright.config.ts`.

### 4. Commit
Stage all modified tracked files:
```
git add -u
```
Also stage any new files that belong in the repo (src, tests, config — not node_modules, dist, .env*, .dev.vars).

Write a commit message that summarises the changes made in this session. Follow the existing commit style (imperative mood, concise subject line, Co-Authored-By trailer).

### 5. Push to GitHub
```
git push
```

### 6. Deploy to Vercel
```
cd app && vercel --prod --yes
```

### 7. Deploy worker to Cloudflare
```
cd worker && wrangler deploy
```

### 8. Verify deployments
After both deploys complete, confirm:
- Vercel build log shows `✓ built` with no errors
- Worker deploy shows the `workers.dev` URL

Report both production URLs to the user:
- Frontend: Vercel URL
- API: `https://freeway-charge-api.bartmanuel.workers.dev`

## Notes
- The Playwright dev server (`webServer`) reuses an existing server on port 5173 if one is already running.
- Infra tests hit live services — they need internet access and valid deployed secrets.
- App API keys come from `app/.env.local` for local tests. The deployed app uses Vercel environment variables.
- Worker secrets are managed via `wrangler secret put` — they are NOT in wrangler.toml.
- If smoke tests hit real APIs they may be slow (up to 45 s for OCM). This is expected.
