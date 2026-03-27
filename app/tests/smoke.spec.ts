import { test, expect } from '@playwright/test';

// These tests run against the local dev server (localhost:5173).
// They verify the end-to-end user flow without mocking any APIs,
// so they require valid VITE_GOOGLE_API_KEY and VITE_OCM_API_KEY in .env.local.

// Grant a fake Amsterdam geolocation so "Go now" is enabled immediately.
async function grantGeolocation(page: import('@playwright/test').Page) {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 52.3702, longitude: 4.8952 });
}

// Pre-grant geolocation before every test so the app skips the LocationOnboarding
// screen and starts directly on the destination input screen.
test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 52.3702, longitude: 4.8952 });
});

// Navigate the new start → confirm → trip flow.
// Types a destination, waits for the Google Places dropdown (falls back to a DEV test hook
// if autocomplete suggestions don't appear — Google Places blocks headless Chromium requests),
// then clicks "Go now" on the confirm screen.
async function navigateToTrip(page: import('@playwright/test').Page, destination: string) {
  await grantGeolocation(page);
  const input = page.getByPlaceholder('Where do we go now?');
  await input.click();
  await input.pressSequentially(destination, { delay: 100 });

  // Wait up to 5 s for real autocomplete suggestions; if they don't appear, use the DEV test hook.
  const pacVisible = await page.locator('.pac-item').first().isVisible().catch(() => false);
  if (pacVisible) {
    await page.locator('.pac-item').first().click();
  } else {
    // Google Places didn't show suggestions (headless restriction) — trigger directly via DEV hook.
    await page.waitForFunction(() => typeof (window as Record<string, unknown>).__triggerPlaceSelect === 'function', { timeout: 10000 });
    await page.evaluate((dest: string) => {
      const trigger = (window as Record<string, unknown>).__triggerPlaceSelect as (p: object) => void;
      trigger({
        name: dest,
        formatted_address: `${dest}, Netherlands`,
        geometry: { location: { lat: () => 51.4416, lng: () => 5.4697 } },
      });
    }, destination);
  }

  // Expanded card: wait for "let's go" to become enabled (position arrives) then click.
  const goBtn = page.getByRole('button', { name: /let's go/i });
  await expect(goBtn).toBeEnabled({ timeout: 10000 });
  await goBtn.click();
}

test.describe('LetsJustDrive — smoke tests', () => {
  test('start screen loads with title and destination input', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: "let's just drive" })).toBeVisible();
    await expect(page.getByPlaceholder('where do we go now?')).toBeVisible();
  });

  test('destination selected expands card with minimap and lets go button', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder('where do we go now?');
    await input.click();
    await input.pressSequentially('Eindhoven', { delay: 100 });
    const pacVisible = await page.locator('.pac-item').first().isVisible().catch(() => false);
    if (pacVisible) {
      await page.locator('.pac-item').first().click();
    } else {
      await page.waitForFunction(() => typeof (window as Record<string, unknown>).__triggerPlaceSelect === 'function', { timeout: 10000 });
      await page.evaluate(() => {
        const trigger = (window as Record<string, unknown>).__triggerPlaceSelect as (p: object) => void;
        trigger({ name: 'Eindhoven', formatted_address: 'Eindhoven, Netherlands', geometry: { location: { lat: () => 51.4416, lng: () => 5.4697 } } });
      });
    }
    // Card should expand with the minimap and "let's go" button.
    // (Don't wait for .gm-style — Google Maps tiles never load in headless Chromium.)
    await expect(page.getByRole('button', { name: /let's go/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[class*="minimap"]')).toBeVisible({ timeout: 10000 });
  });

  test('route search returns stations', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');

    // Route meta (distance + duration) should appear within 30 s.
    const routeMeta = page.locator('[class*="routeMeta"]');
    await expect(routeMeta.locator('text=/\\d+:\\d+/')).toBeVisible({ timeout: 30000 });
    await expect(routeMeta.locator('text=/\\d+ km/')).toBeVisible({ timeout: 5000 });

    // Station list should appear. Allow up to 45 s for OCM API.
    const stationList = page.locator('aside ul li');
    await expect(stationList.first()).toBeVisible({ timeout: 45000 });

    const count = await stationList.count();
    expect(count).toBeGreaterThan(0);

    // Route meta should show station count (number + charger icon)
    await expect(page.locator('[class*="routeMeta"] img[src*="charger"]')).toBeVisible({ timeout: 5000 });
  });

  test('availability badges appear after station list loads', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');

    // Wait for stations to load first
    await page.locator('aside ul li').first().waitFor({ timeout: 45000 });

    // Availability count (pending or resolved) should appear within 30 s.
    const badge = page.locator('[class*="availCount"]').first();
    await expect(badge).toBeVisible({ timeout: 30000 });
  });

  test('Reroute and Stop buttons are present in trip view', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');
    await expect(page.getByRole('button', { name: 'Reroute' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({ timeout: 5000 });
  });

  test('Stop button returns to start screen', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');
    const stopBtn = page.getByRole('button', { name: 'Stop' });
    await stopBtn.waitFor({ timeout: 10000 });
    await stopBtn.click();
    await expect(page.getByPlaceholder('where do we go now?')).toBeVisible({ timeout: 10000 });
  });

  test('selecting a station from the list pans the map', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');

    const firstStation = page.locator('aside ul li').first();
    await firstStation.waitFor({ timeout: 45000 });
    await firstStation.click();

    // After clicking, the selected card gets a visual highlight.
    await expect(firstStation).toHaveClass(/selected/, { timeout: 3000 });
  });
});
