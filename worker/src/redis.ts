import { Env } from './types';

export async function redisGet(env: Env, key: string): Promise<string | null> {
  const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
  const json = await res.json() as { result: string | null };
  return json.result;
}

export async function redisSet(
  env: Env,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  await fetch(`${env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${ttlSeconds}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` },
  });
}
