import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiGet, withQuery, type Query } from './api';

export type ApiState<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  /** True only for the first load (show skeletons). Refreshes keep the old data on screen. */
  loading: boolean;
  /** True while any request is in flight, including refreshes. */
  busy: boolean;
  reload: () => void;
};

/**
 * Loads data for a screen and keeps it fresh. Every widget must render all three states:
 * loading (skeleton), error (ErrorState with retry) and empty (EmptyState).
 *
 *   const { data, error, loading, reload } = useApi<Summary>('/dashboard/summary', undefined, { refreshMs: 30_000 });
 */
export function useApi<T>(path: string | null, query?: Query, options?: { refreshMs?: number }): ApiState<T> {
  const key = path ? withQuery(path, query) : null;
  const [state, setState] = useState<{ data?: T; error?: ApiError; busy: boolean }>({ busy: !!key });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, busy: true }));
    apiGet<T>(key, undefined, controller.signal)
      .then((data) => setState({ data, busy: false }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const error = err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong.');
        setState((s) => ({ data: s.data, error, busy: false }));
      });
    return () => controller.abort();
  }, [key, tick]);

  const refreshMs = options?.refreshMs;
  useEffect(() => {
    if (!refreshMs || !key) return;
    const id = window.setInterval(reload, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, key, reload]);

  return {
    data: state.data,
    error: state.error,
    loading: state.data === undefined && !state.error,
    busy: state.busy,
    reload,
  };
}
