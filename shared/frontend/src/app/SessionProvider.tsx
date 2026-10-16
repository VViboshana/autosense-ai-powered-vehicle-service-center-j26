import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiGet } from '@/lib/api';
import { setTimeZone } from '@/lib/format';
import { SessionContext, type AppConfig, type Me, type MenuNode, type Session } from './session';

type LoadState = { status: 'loading' } | { status: 'error'; error: ApiError } | { status: 'ready'; session: Session };

/** Loads who is signed in, their menu and the app settings once, before any screen renders. */
export function SessionProvider({ loading, failed, children }: {
  loading: ReactNode;
  failed: (error: ApiError, retry: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiGet<Me>('/me'), apiGet<MenuNode[]>('/navigation/menu'), apiGet<AppConfig>('/app-config')])
      .then(([me, menu, config]) => {
        if (cancelled) return;
        const tz = config.settings['app.timezone'];
        if (typeof tz === 'string') setTimeZone(tz);
        const granted = new Set(me.permissions);
        setState({ status: 'ready', session: { me, menu, config, can: (code) => me.isSuperAdmin || granted.has(code) } });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', error: err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong.') });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === 'loading') return <>{loading}</>;
  if (state.status === 'error') {
    return (
      <>
        {failed(state.error, () => {
          setState({ status: 'loading' });
          setAttempt((a) => a + 1);
        })}
      </>
    );
  }
  return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
}
