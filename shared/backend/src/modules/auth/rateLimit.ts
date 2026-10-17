/**
 * Slows down password guessing: at most `limit` attempts per key in a window. Kept in memory, which is enough for
 * one API process; the account lockout (auth.lockout) is the durable protection.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Counts an attempt. Returns the seconds to wait when over the limit, otherwise 0. */
    hit(key: string): number {
      const now = Date.now();
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return 0;
      }
      entry.count++;
      return entry.count > limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
