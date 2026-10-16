import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, apiGet, apiSend, SIGNED_OUT_EVENT } from '@/lib/api';
import { setTimeZone } from '@/lib/format';
import { AuthContext, type AppConfig, type Auth, type Me, type MenuNode, type Session } from './session';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'ready'; config: AppConfig; signedIn: { me: Me; menu: MenuNode[] } | null; notice: string | null };

/**
 * Loads the public app settings, then who is signed in (if anyone). Screens read it with useAuth() / useSession().
 * When the server reports the session has ended, the user goes back to the sign-in page with a notice.
 */
export function AuthProvider({ loading, failed, children }: {
  loading: ReactNode;
  failed: (error: ApiError, retry: () => void) => ReactNode;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const loadUser = useCallback(async (): Promise<{ me: Me; menu: MenuNode[] } | null> => {
    try {
      const me = await apiGet<Me>('/me');
      const menu = await apiGet<MenuNode[]>('/navigation/menu');
      return { me, menu };
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const config = await apiGet<AppConfig>('/app-config');
      const tz = config.settings['app.timezone'];
      if (typeof tz === 'string') setTimeZone(tz);
      const signedIn = await loadUser();
      if (!cancelled) setState({ status: 'ready', config, signedIn, notice: null });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ status: 'error', error: err instanceof ApiError ? err : new ApiError(0, 'UNKNOWN', 'Something went wrong.') });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, loadUser]);

  /** Reloads the app config (e.g. setup no longer needed) and who is signed in. */
  const refresh = useCallback(async () => {
    const [config, signedIn] = await Promise.all([apiGet<AppConfig>('/app-config'), loadUser()]);
    setState((s) => (s.status === 'ready' ? { ...s, config, signedIn, notice: null } : s));
  }, [loadUser]);

  const signOut = useCallback(async () => {
    await apiSend('POST', '/auth/logout').catch(() => undefined);
    setState((s) => (s.status === 'ready' ? { ...s, signedIn: null, notice: 'You have signed out.' } : s));
  }, []);

  useEffect(() => {
    const onSignedOut = () =>
      setState((s) => (s.status === 'ready' && s.signedIn ? { ...s, signedIn: null, notice: 'Your session ended. Sign in again to continue.' } : s));
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, []);

  const auth = useMemo<Auth | null>(() => {
    if (state.status !== 'ready') return null;
    let session: Session | null = null;
    if (state.signedIn) {
      const { me, menu } = state.signedIn;
      const granted = new Set(me.permissions);
      session = { me, menu, config: state.config, can: (code) => granted.has(code), signOut, refresh };
    }
    return { config: state.config, session, notice: state.notice, refresh };
  }, [state, signOut, refresh]);

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
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}
