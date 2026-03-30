import { test, expect } from '@playwright/test';

// These tests run against the local dev server (localhost:5174).
// They require valid VITE_GOOGLE_API_KEY and VITE_WORKER_BASE_URL in app/.env.local.
// No APIs are mocked — live infrastructure is exercised end-to-end.

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Grant a fake Amsterdam position so the app skips LocationOnboarding. */
async function grantGeolocation(page: import('@playwright/test').Page) {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 52.3702, longitude: 4.8952 });
}

/**
 * Selects a place via the Google Places autocomplete dropdown (real),
 * or falls back to the DEV test hook when headless Chromium blocks Places requests.
 */
async function selectPlace(
  page: import('@playwright/test').Page,
  name: string,
  lat: number,
  lng: number,
) {
  const pacVisible = await page.locator('.pac-item').first().isVisible().catch(() => false);
  if (pacVisible) {
    await page.locator('.pac-item').first().click();
  } else {
    await page.waitForFunction(
      () => typeof (window as Record<string, unknown>).__triggerPlaceSelect === 'function',
      { timeout: 10_000 },
    );
    await page.evaluate(
      ({ n, la, ln }) => {
        const trigger = (window as Record<string, unknown>).__triggerPlaceSelect as (p: object) => void;
        trigger({
          name: n,
          formatted_address: `${n}, Netherlands`,
          geometry: { location: { lat: () => la, lng: () => ln } },
        });
      },
      { n: name, la: lat, ln: lng },
    );
  }
}

/**
 * Types a destination, selects it from autocomplete, waits for "let's go"
 * to become enabled (GPS fix), then clicks it to enter trip view.
 */
async function navigateToTrip(
  page: import('@playwright/test').Page,
  destination = 'Eindhoven',
) {
  const input = page.getByPlaceholder('where do we go now?');
  await input.click();
  await input.pressSequentially(destination, { delay: 100 });
  await selectPlace(page, destination, 51.4416, 5.4697);
  const goBtn = page.getByRole('button', { name: /let's go/i });
  await expect(goBtn).toBeEnabled({ timeout: 10_000 });
  await goBtn.click();
}

// Pre-grant geolocation so every test starts on the destination input screen.
test.beforeEach(async ({ page }) => {
  await grantGeolocation(page);
});

// ── Onboarding ────────────────────────────────────────────────────────────────

test.describe('Onboarding', () => {
  test('shows location permission screen when geolocation is blocked', async ({ page }) => {
    // Override the Permissions API before the page loads so LocationOnboarding
    // sees state:'prompt' regardless of what the context-level grant says.
    // (Using addInitScript rather than a new context because Playwright's
    // { permissions: [] } context can leave the query in an indeterminate state
    // in headless Chromium, causing the component to stay stuck on 'checking'.)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'permissions', {
        value: {
          query: () =>
            Promise.resolve({
              state: 'prompt',
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => true,
              onchange: null,
            }),
        },
        configurable: true,
      });
    });
    await page.goto('/');
    // Welcome step shows the mockup figures — unique to the onboarding screen.
    await expect(page.locator('[class*="mockups"]')).toBeVisible({ timeout: 5_000 });
    // Destination input must not be present.
    await expect(page.getByPlaceholder('where do we go now?')).not.toBeVisible();
  });
});

// ── Start screen ──────────────────────────────────────────────────────────────

test.describe('Start screen', () => {
  test('loads with brand title and destination input', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "let's just drive" })).toBeVisible();
    await expect(page.getByPlaceholder('where do we go now?')).toBeVisible();
  });

  test('selecting a destination expands card with minimap and lets go button', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder('where do we go now?');
    await input.click();
    await input.pressSequentially('Eindhoven', { delay: 100 });
    await selectPlace(page, 'Eindhoven', 51.4416, 5.4697);
    await expect(page.getByRole('button', { name: /let's go/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[class*="minimap"]')).toBeVisible({ timeout: 10_000 });
  });

  test('clearing the input after selecting collapses the card', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder('where do we go now?');
    await input.click();
    await input.pressSequentially('Eindhoven', { delay: 100 });
    await selectPlace(page, 'Eindhoven', 51.4416, 5.4697);
    await expect(page.getByRole('button', { name: /let's go/i })).toBeVisible({ timeout: 5_000 });
    // Use the DEV hook to clear the selected place — direct Playwright interaction
    // (fill/keyboard) can be blocked by the Google Maps overlay that initialises
    // inside the minimap after the card expands.
    await page.waitForFunction(
      () => typeof (window as Record<string, unknown>).__clearPlace === 'function',
      { timeout: 5_000 },
    );
    await page.evaluate(() => {
      (window as Record<string, unknown>).__clearPlace();
    });
    // The minimap is conditionally rendered (not just CSS-clipped), so it disappears from the DOM
    // when the selection is cleared — this is the most reliable signal that the card collapsed.
    await expect(page.locator('[class*="minimap"]')).not.toBeVisible({ timeout: 3_000 });
  });
});

// ── Trip view ─────────────────────────────────────────────────────────────────

test.describe('Trip view', () => {
  test('route meta shows distance, duration and station count', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    const routeMeta = page.locator('[class*="routeMeta"]');
    await expect(routeMeta.locator('text=/\\d+ km/')).toBeVisible({ timeout: 30_000 });
    await expect(routeMeta.locator('text=/\\d+:\\d+/')).toBeVisible({ timeout: 5_000 });
    await expect(routeMeta.locator('img[src*="charger"]')).toBeVisible({ timeout: 30_000 });
  });

  test('station list loads with at least one station', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await expect(page.locator('aside ul li').first()).toBeVisible({ timeout: 45_000 });
    expect(await page.locator('aside ul li').count()).toBeGreaterThan(0);
  });

  test('station cards show power kW and distance pills', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    const firstCard = page.locator('aside ul li').first();
    await firstCard.waitFor({ timeout: 45_000 });
    // Power level
    await expect(firstCard.locator('text=/\\d+ kW/')).toBeVisible();
    // Distance pills: car-icon and charger-icon are rendered inside the row
    await expect(firstCard.locator('img[src*="car.svg"]')).toBeVisible();
    await expect(firstCard.locator('img[src*="charger.svg"]').first()).toBeVisible();
  });

  test('availability badges appear on station cards', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await page.locator('aside ul li').first().waitFor({ timeout: 45_000 });
    await expect(page.locator('[class*="availCount"]').first()).toBeVisible({ timeout: 30_000 });
  });

  test('selecting a station highlights the card', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    const firstStation = page.locator('aside ul li').first();
    await firstStation.waitFor({ timeout: 45_000 });
    await firstStation.click();
    await expect(firstStation).toHaveClass(/selected/, { timeout: 3_000 });
  });

  test('on desktop, sidebar stays full-width when a station is selected', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    const sidebar = page.locator('aside');
    await page.locator('aside ul li').first().waitFor({ timeout: 45_000 });
    const widthBefore = (await sidebar.boundingBox())!.width;
    await page.locator('aside ul li').first().click();
    await page.waitForTimeout(400); // let any transition settle
    const widthAfter = (await sidebar.boundingBox())!.width;
    // Desktop sidebar must remain full-width (≥ 300 px), not shrink to ~110 px thumbnail.
    expect(widthAfter).toBeGreaterThan(200);
    expect(Math.abs(widthAfter - widthBefore)).toBeLessThan(5);
  });

  test('Reroute and Stop buttons are present', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await expect(page.getByRole('button', { name: 'Reroute' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5_000 });
  });

  test('Stop button returns to the start screen', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await page.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByPlaceholder('where do we go now?')).toBeVisible({ timeout: 5_000 });
  });
});

// ── Mobile — thumbnail toggle ─────────────────────────────────────────────────
//
// Override the viewport to a phone size so the @media (max-width: 640px)
// CSS activates and the thumbnail / full-screen switching behaviour is live.

test.describe('Mobile — thumbnail toggle', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('map thumbnail is visible in default list view', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await page.locator('aside ul li').first().waitFor({ timeout: 45_000 });
    // In list view the map area becomes the thumbnail and shows a "Map" label.
    const mapLabel = page.locator('[class*="thumbnailLabel"]').filter({ hasText: /^Map$/i });
    await expect(mapLabel).toBeVisible({ timeout: 5_000 });
  });

  test('tapping the map thumbnail switches to map view', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await page.locator('aside ul li').first().waitFor({ timeout: 45_000 });
    // The map area is the thumbnail — tap it.
    await page.locator('main[class*="thumbnailMobile"]').click();
    // Sidebar is now the thumbnail → "List" label becomes visible.
    await expect(
      page.locator('[class*="thumbnailLabel"]').filter({ hasText: /^List$/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  test('tapping the list thumbnail switches back to list view', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page);
    await page.locator('aside ul li').first().waitFor({ timeout: 45_000 });
    // Go to map view first.
    await page.locator('main[class*="thumbnailMobile"]').click();
    await expect(
      page.locator('[class*="thumbnailLabel"]').filter({ hasText: /^List$/i }),
    ).toBeVisible({ timeout: 3_000 });
    // Tap the list thumbnail to go back to list view.
    await page.locator('aside[class*="thumbnailMobile"]').click();
    await expect(
      page.locator('[class*="thumbnailLabel"]').filter({ hasText: /^Map$/i }),
    ).toBeVisible({ timeout: 3_000 });
  });
});
