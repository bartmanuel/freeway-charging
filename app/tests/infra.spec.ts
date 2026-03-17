import { test, expect } from '@playwright/test';

// Infrastructure smoke tests — verify Cloudflare Worker, Supabase, and Upstash
// are all reachable and healthy before shipping.
// These are pure API calls; no browser is needed.

const WORKER_URL = 'https://freeway-charge-api.bartmanuel.workers.dev';

test.describe('Infrastructure health', () => {
  test('Cloudflare Worker is up', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/api/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test('Supabase and Upstash are reachable (deep health check)', async ({ request }) => {
    const res = await request.get(`${WORKER_URL}/api/health?deep=true`);
    const body = await res.json();

    // Report service-level failures clearly
    expect(body.services.supabase, `Supabase: ${body.services.supabase}`).toBe('ok');
    expect(body.services.upstash, `Upstash: ${body.services.upstash}`).toBe('ok');
    expect(res.ok(), `Worker returned ${res.status()}: ${JSON.stringify(body)}`).toBe(true);
  });

  test('corridor endpoint responds (Supabase query path)', async ({ request }) => {
    // Amsterdam bounding box — table may be empty but the query must succeed
    const res = await request.post(`${WORKER_URL}/api/stations/corridor`, {
      data: { minLat: 52.2, maxLat: 52.5, minLng: 4.7, maxLng: 5.1 },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });
});
