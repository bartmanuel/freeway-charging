import { Env } from './types';
import { handleRoute } from './handlers/route';
import { handleCorridor } from './handlers/corridor';
import { handleAvailability } from './handlers/availability';
import { handleHealth } from './handlers/health';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    let res: Response;

    if (path === '/api/route' && req.method === 'POST') {
      res = await handleRoute(req, env);
    } else if (path === '/api/stations/corridor' && req.method === 'POST') {
      res = await handleCorridor(req, env);
    } else if (path.startsWith('/api/stations/') && path.endsWith('/availability') && req.method === 'GET') {
      const stationId = path.split('/')[3];
      res = await handleAvailability(req, env, stationId);
    } else if (path === '/api/health' && req.method === 'GET') {
      const deep = url.searchParams.get('deep') === 'true';
      res = await handleHealth(req, env, deep);
    } else {
      res = new Response('Not found', { status: 404 });
    }

    // Attach CORS headers to every response
    const corsRes = new Response(res.body, res);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => corsRes.headers.set(k, v));
    return corsRes;
  },
};
