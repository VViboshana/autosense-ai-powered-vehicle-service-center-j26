import type { Db } from '../db/pool.js';

/**
 * Reads an application setting (app.settings) merged over a default, so a missing key never breaks the API.
 * Cached for 30 seconds: a change made in the app applies within half a minute.
 */
const cache = new Map<string, { value: unknown; at: number }>();
const TTL_MS = 30_000;

export async function getSetting<T extends object>(db: Db, key: string, fallback: T): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...fallback, ...(hit.value as Partial<T>) };
  const { rows } = await db.query<{ value: unknown }>('SELECT value FROM app.settings WHERE setting_key = $1', [key]);
  const value = rows[0]?.value ?? {};
  cache.set(key, { value, at: Date.now() });
  return { ...fallback, ...(value as Partial<T>) };
}

export function clearSettingsCache() {
  cache.clear();
}
