import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorState } from '@/components/ui/States';
import { AppLayout } from '@/layout/AppLayout';
import { AccessDeniedPage, ComingSoonPage, NotFoundPage } from '@/modules/system/SystemPages';
import { SCREENS, type ScreenRoute } from './screens';
import { findMenuLink, useSession } from './session';
import { SessionProvider } from './SessionProvider';

/** Opens a built screen only when the user's role allows it. */
function Guarded({ screen }: { screen: ScreenRoute }) {
  const { can, menu } = useSession();
  if (can(screen.code)) return <>{screen.element}</>;
  const name = findMenuLink(menu, screen.path)?.name ?? 'this screen';
  return <AccessDeniedPage name={name} />;
}

/** Any other address: a menu screen that isn't built yet, or a real "not found". */
function Fallback() {
  const { menu } = useSession();
  const { pathname } = useLocation();
  const link = findMenuLink(menu, pathname);
  return link ? <ComingSoonPage name={link.name} icon={link.icon} /> : <NotFoundPage />;
}

const booting = (
  <div className="as-boot" role="status">
    <div>
      <div className="spinner-border text-secondary" aria-hidden="true" />
      <div className="mt-2 small">Loading AutoSense…</div>
    </div>
  </div>
);

export function App() {
  return (
    <SessionProvider
      loading={booting}
      failed={(error, retry) => (
        <div className="as-boot">
          <ErrorState error={error} onRetry={retry} title="AutoSense couldn't start" />
        </div>
      )}
    >
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            {SCREENS.map((s) => (
              <Route key={s.code} path={s.path} element={<Guarded screen={s} />} />
            ))}
            <Route path="*" element={<Fallback />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}
