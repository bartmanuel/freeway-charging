import { test, expect } from '@playwright/test';

// Infrastructure smoke tests — verify Cloudflare Worker, Supabase, and Upstash
// are all reachable and healthy before shipping.
// These are pure API calls; no browser is needed.

// Infra tests use the stable workers.dev URL directly — the custom domain
// api.letsjustdrive.app is set up in Cloudflare and points here.
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

  test('route endpoint returns a valid polyline (Google Routes API key)', async ({ request }) => {
    const res = await request.post(`${WORKER_URL}/api/route`, {
      data: { origin: 'Amsterdam, Netherlands', destination: 'Eindhoven, Netherlands' },
    });
    expect(res.ok(), `Worker returned ${res.status()}`).toBe(true);
    const body = await res.json();
    const route = body.routes?.[0];
    expect(route, 'routes[0] missing').toBeTruthy();
    expect(typeof route.distanceMeters).toBe('number');
    expect(route.distanceMeters).toBeGreaterThan(50_000);
    expect(typeof route.polyline?.encodedPolyline).toBe('string');
    expect(route.polyline.encodedPolyline.length).toBeGreaterThan(100);
  });

  test('availability endpoint returns a result map (TomTom API key)', async ({ request }) => {
    // Single well-known IONITY station near Utrecht (OCM ID 45497) as a minimal payload
    const res = await request.post(`${WORKER_URL}/api/stations/availability`, {
      data: [
        {
          id: '45497',
          lat: 52.0843,
          lng: 5.0571,
          name: 'IONITY De Kroon',
          operator: 'IONITY',
          connectors: [{ type: 'CCS (Type 2)', powerKw: 350 }],
        },
      ],
    });
    expect(res.ok(), `Worker returned ${res.status()}`).toBe(true);
    const body = await res.json();
    // Response must be an object keyed by station id
    expect(typeof body).toBe('object');
    expect('45497' in body).toBe(true);
    // Each value is { connectors: ConnectorAvailability[] | null, history: HistoryPoint[] }
    const val = body['45497'];
    expect(typeof val).toBe('object');
    expect(Array.isArray(val.history)).toBe(true);
    if (val.connectors !== null) {
      expect(Array.isArray(val.connectors)).toBe(true);
      if (val.connectors.length > 0) {
        expect(typeof val.connectors[0].total).toBe('number');
        expect(typeof val.connectors[0].available).toBe('number');
      }
    }
  });
});
