import { test, expect } from '@playwright/test';

// These tests run against the local dev server (localhost:5173).
// They verify the end-to-end user flow without mocking any APIs,
// so they require valid VITE_GOOGLE_API_KEY and VITE_OCM_API_KEY in .env.local.

// Grant a fake Amsterdam geolocation so "Go now" is enabled immediately.
async function grantGeolocation(page: import('@playwright/test').Page) {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 52.3702, longitude: 4.8952 });
}

// Navigate the new start → confirm → trip flow.
// Types a destination, waits for the Google Places dropdown, selects the first result,
// then clicks "Go now" on the confirm screen.
async function navigateToTrip(page: import('@playwright/test').Page, destination: string) {
  await grantGeolocation(page);
  const input = page.getByPlaceholder('Enter destination');
  await input.click();
  await input.pressSequentially(destination, { delay: 80 });
  // Wait for the Google Places autocomplete dropdown to appear, then pick first item.
  await page.locator('.pac-container').waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // Confirm screen: wait for Go now to become enabled (position arrives) then click.
  const goBtn = page.getByRole('button', { name: /go now/i });
  await expect(goBtn).toBeEnabled({ timeout: 10000 });
  await goBtn.click();
}

test.describe('Freeway Charge — smoke tests', () => {
  test('start screen loads with title and destination input', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Freeway Charge' })).toBeVisible();
    await expect(page.getByText('Where do we go now?')).toBeVisible();
    await expect(page.getByPlaceholder('Enter destination')).toBeVisible();
  });

  test('confirm screen shows map and Go now button', async ({ page }) => {
    await page.goto('/');
    await grantGeolocation(page);
    const input = page.getByPlaceholder('Enter destination');
    await input.click();
    await input.pressSequentially('Eindhoven', { delay: 80 });
    await page.locator('.pac-container').waitFor({ state: 'visible', timeout: 10000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    // Confirm screen should appear with the Go now button and a map
    await expect(page.getByRole('button', { name: /go now/i })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.gm-style')).toBeVisible({ timeout: 10000 });
  });

  test('route search returns stations', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');

    // Route meta (distance + duration) should appear within 30 s.
    const routeMeta = page.locator('[class*="routeMeta"]');
    await expect(routeMeta.locator('text=/\\d+ min/')).toBeVisible({ timeout: 30000 });
    await expect(routeMeta.locator('text=/\\d+ km/')).toBeVisible({ timeout: 5000 });

    // Station list should appear. Allow up to 45 s for OCM API.
    const stationList = page.locator('aside ul li');
    await expect(stationList.first()).toBeVisible({ timeout: 45000 });

    const count = await stationList.count();
    expect(count).toBeGreaterThan(0);

    // Route meta should show station count
    await expect(page.locator(`text=/\\d+ stations/`)).toBeVisible({ timeout: 5000 });
  });

  test('availability badges appear after station list loads', async ({ page }) => {
    await page.goto('/');
    await navigateToTrip(page, 'Eindhoven, Netherlands');

    // Wait for stations to load first
    await page.locator('aside ul li').first().waitFor({ timeout: 45000 });

    // Availability badges (pending or resolved) should appear within 30 s.
    const badge = page.locator('[class*="availBadge"]').first();
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
    await page.getByRole('button', { name: 'Stop' }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByPlaceholder('Enter destination')).toBeVisible({ timeout: 5000 });
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
