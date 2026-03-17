import { Env } from '../types';
import { redisGet, redisSet } from '../redis';

async function checkSupabase(env: Env): Promise<'ok' | string> {
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/stations?select=id&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!res.ok) return `http ${res.status}`;
    return 'ok';
  } catch (e) {
    return String(e);
  }
}

async function checkUpstash(env: Env): Promise<'ok' | string> {
  try {
    await redisSet(env, '_healthcheck', '1', 10);
    const val = await redisGet(env, '_healthcheck');
    if (val !== '1') return 'read-back mismatch';
    return 'ok';
  } catch (e) {
    return String(e);
  }
}

export async function handleHealth(_req: Request, env: Env, deep: boolean): Promise<Response> {
  if (!deep) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [supabase, upstash] = await Promise.all([
    checkSupabase(env),
    checkUpstash(env),
  ]);

  const ok = supabase === 'ok' && upstash === 'ok';
  return new Response(
    JSON.stringify({ ok, services: { supabase, upstash } }),
    {
      status: ok ? 200 : 503,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}
