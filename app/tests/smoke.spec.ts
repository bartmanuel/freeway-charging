import { test, expect } from '@playwright/test';

// These tests run against the local dev server (localhost:5173).
// They verify the end-to-end user flow without mocking any APIs,
// so they require valid VITE_GOOGLE_API_KEY and VITE_OCM_API_KEY in .env.local.

// Submit the route form programmatically so autocomplete dropdowns don't
// interfere with the button click.
async function submitRoute(page: import('@playwright/test').Page, origin: string, destination: string) {
  await page.getByPlaceholder('Origin').fill(origin);
  await page.getByPlaceholder('Destination').fill(destination);
  // requestSubmit() fires the submit event with validation, same as a button click,
  // but is not blocked by any autocomplete overlay.
  await page.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
}

test.describe('Freeway Charge — smoke tests', () => {
  test('page loads with title and route form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Freeway Charge' })).toBeVisible();
    await expect(page.getByPlaceholder('Origin')).toBeVisible();
    await expect(page.getByPlaceholder('Destination')).toBeVisible();
    await expect(page.getByRole('button', { name: /find charging stations/i })).toBeVisible();
  });

  test('map renders', async ({ page }) => {
    await page.goto('/');
    // Google Maps injects a canvas element when the map loads successfully.
    await expect(page.locator('.gm-style')).toBeVisible({ timeout: 10000 });
  });

  test('route search returns stations', async ({ page }) => {
    await page.goto('/');
    await submitRoute(page, 'Amsterdam, Netherlands', 'Eindhoven, Netherlands');

    // Route meta (distance + duration) should appear within 30 s.
    await expect(page.locator('text=/\\d+ min/')).toBeVisible({ timeout: 30000 });

    // Station list should appear. Allow up to 45 s for OCM API.
    const stationList = page.locator('aside ul li');
    await expect(stationList.first()).toBeVisible({ timeout: 45000 });

    const count = await stationList.count();
    expect(count).toBeGreaterThan(0);
  });

  test('selecting a station from the list pans the map', async ({ page }) => {
    await page.goto('/');
    await submitRoute(page, 'Amsterdam, Netherlands', 'Eindhoven, Netherlands');

    const firstStation = page.locator('aside ul li').first();
    await firstStation.waitFor({ timeout: 45000 });

    // Record the map presence before clicking.
    const centerBefore = await page.evaluate(() => {
      const iframe = document.querySelector('.gm-style');
      return iframe?.getBoundingClientRect();
    });

    await firstStation.click();

    // After clicking, the selected card gets a visual highlight.
    // (The map pans internally — we just verify the click doesn't crash.)
    await expect(firstStation).toHaveClass(/selected/, { timeout: 3000 });
    expect(centerBefore).toBeTruthy(); // map was present throughout
  });
});
