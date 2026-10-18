/**
 * The AI services (FastAPI, one per component). The API calls them; the browser never does.
 * Each service must answer GET /health with HTTP 200 when it is ready.
 */
export type MlServiceName = 'damage' | 'occupancy';
export type MlServiceStatus = { status: 'up' | 'down' | 'not_configured'; url?: string; latencyMs?: number; error?: string };

export async function checkMlService(url: string | undefined, timeoutMs = 2000): Promise<MlServiceStatus> {
  if (!url) return { status: 'not_configured' };
  const started = performance.now();
  try {
    const res = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(timeoutMs) });
    const latencyMs = Math.round(performance.now() - started);
    return res.ok ? { status: 'up', url, latencyMs } : { status: 'down', url, latencyMs, error: `HTTP ${res.status}` };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? `no answer in ${timeoutMs} ms` : 'not running';
    return { status: 'down', url, error: reason };
  }
}
