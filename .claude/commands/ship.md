Run the full test → commit → deploy pipeline for Freeway Charge.

## Steps

Work through these steps in order. Stop and report if any step fails — do not proceed to the next step.

### 1. Type check + build
```
cd app && npm run build
```
Fix any TypeScript or build errors before continuing.

### 2. Smoke tests (Playwright / Chromium)
```
cd app && npm test
```
This launches a real Chromium instance against the local dev server and runs 4 smoke tests:
- Page loads with title and form
- Google Map renders
- Route search (Amsterdam → Eindhoven) returns stations
- Clicking a station selects it

If any test fails, investigate and fix before continuing. The dev server starts automatically via the `webServer` config in `playwright.config.ts`.

### 3. Commit
Stage all modified tracked files:
```
git add -u
```
Also stage any new files that belong in the repo (src, tests, config — not node_modules, dist, .env*).

Write a commit message that summarises the changes made in this session. Follow the existing commit style (imperative mood, concise subject line, Co-Authored-By trailer).

### 4. Push to GitHub
```
git push
```

### 5. Deploy to Vercel
```
cd app && vercel --prod --yes
```

### 6. Verify deployment
After Vercel reports the production URL, confirm the build log shows `✓ built` with no errors.

Report the final production URL to the user.

## Notes
- The Playwright dev server (`webServer`) reuses an existing server on port 5173 if one is already running.
- API keys come from `app/.env.local` for local tests. The deployed app uses Vercel environment variables.
- If tests hit real APIs they may be slow (up to 45 s for OCM). This is expected.
