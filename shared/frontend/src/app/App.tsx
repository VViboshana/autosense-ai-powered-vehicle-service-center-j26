import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorState } from '@/components/ui/States';
import { AppLayout } from '@/layout/AppLayout';
import { AccountPage } from '@/modules/auth/AccountPage';
import { AuthShell } from '@/modules/auth/AuthShell';
import { ChangePasswordForm } from '@/modules/auth/ChangePasswordForm';
import { LoginPage } from '@/modules/auth/LoginPage';
import { RegisterPage } from '@/modules/auth/RegisterPage';
import { SetupPage } from '@/modules/auth/SetupPage';
import { CustomerLayout } from '@/modules/customer/CustomerLayout';
import { MyAccountPage } from '@/modules/customer/MyAccountPage';
import { MyVehiclePage } from '@/modules/customer/MyVehiclePage';
import { MyVehiclesPage } from '@/modules/customer/MyVehiclesPage';
import { AccessDeniedPage, ComingSoonPage, NotFoundPage } from '@/modules/system/SystemPages';
import { AuthProvider } from './AuthProvider';
import { SCREENS, type ScreenRoute } from './screens';
import { findMenuLink, useAuth, useSession } from './session';

/** Opens a built screen only when the user's role allows it. */
function Guarded({ screen }: { screen: ScreenRoute }) {
  const { can, menu } = useSession();
  if (can(screen.code)) return <>{screen.element}</>;
  return <AccessDeniedPage name={findMenuLink(menu, screen.path)?.name ?? 'this screen'} />;
}

/** Any other address: a menu screen that isn't built yet, or a real "not found". */
function Fallback() {
  const { menu } = useSession();
  const { pathname } = useLocation();
  const link = findMenuLink(menu, pathname);
  return link ? <ComingSoonPage name={link.name} icon={link.icon} /> : <NotFoundPage />;
}

/** Not signed in: remember where the user was going, then show sign-in. */
function ToLogin() {
  const { pathname, search } = useLocation();
  const next = pathname === '/' || pathname === '/login' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
  return <Navigate to={`/login${next}`} replace />;
}

function AppRoutes() {
  const { session, config } = useAuth();

  // First run: no staff account yet, so the only page is "Create the administrator"
  if (!session && config.setup.needed) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<ToLogin />} />
      </Routes>
    );
  }

  if (session.me.mustChangePassword) {
    return (
      <AuthShell title="Change your password">
        <h2>Change your password</h2>
        <p className="text-body-secondary mb-4">Choose a new password before you continue.</p>
        <ChangePasswordForm />
      </AuthShell>
    );
  }

  // Customers: their own pages only
  if (session.me.userType === 'customer') {
    return (
      <Routes>
        <Route path="/my" element={<CustomerLayout />}>
          <Route index element={<MyVehiclesPage />} />
          <Route path="vehicles/:id" element={<MyVehiclePage />} />
          <Route path="account" element={<MyAccountPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/my" replace />} />
      </Routes>
    );
  }

  // Staff
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/my/*" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        {SCREENS.map((s) => (
          <Route key={s.code} path={s.path} element={<Guarded screen={s} />} />
        ))}
        <Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<Fallback />} />
      </Route>
    </Routes>
  );
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
    <BrowserRouter>
      <AuthProvider
        loading={booting}
        failed={(error, retry) => (
          <div className="as-boot">
            <ErrorState error={error} onRetry={retry} title="AutoSense couldn't start" />
          </div>
        )}
      >
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
