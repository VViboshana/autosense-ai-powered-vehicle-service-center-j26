import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorState } from '@/components/ui/States';
import { AppLayout } from '@/layout/AppLayout';
import { AccountPage } from '@/modules/auth/AccountPage';
import { AuthShell } from '@/modules/auth/AuthShell';
import { ChangePasswordForm } from '@/modules/auth/ChangePasswordForm';
import { LoginPage } from '@/modules/auth/LoginPage';
import { RegisterPage } from '@/modules/auth/RegisterPage';
import { SetupPage } from '@/modules/auth/SetupPage';
import { BookingsPage } from '@/modules/customer/BookingsPage';
import { CustomerLayout } from '@/modules/customer/CustomerLayout';
import { HistoryPage } from '@/modules/customer/HistoryPage';
import { MyAccountPage } from '@/modules/customer/MyAccountPage';
import { MyVehiclePage } from '@/modules/customer/MyVehiclePage';
import { MyVehiclesPage } from '@/modules/customer/MyVehiclesPage';
import { NewBookingPage } from '@/modules/customer/NewBookingPage';
import { NotificationsPage } from '@/modules/customer/NotificationsPage';
import { PortalHomePage } from '@/modules/customer/PortalHomePage';
import { AboutPage } from '@/modules/site/AboutPage';
import { ContactPage } from '@/modules/site/ContactPage';
import { HomePage } from '@/modules/site/HomePage';
import { HowItWorksPage } from '@/modules/site/HowItWorksPage';
import { PrivacyPage, SiteNotFound, TermsPage } from '@/modules/site/InfoPages';
import { ServicesPage } from '@/modules/site/ServicesPage';
import { SiteLayout } from '@/modules/site/SiteLayout';
import { AccessDeniedPage, ComingSoonPage, NotFoundPage } from '@/modules/system/SystemPages';
import { AuthProvider } from './AuthProvider';
import { SCREENS, type ScreenRoute } from './screens';
import { findMenuLink, useAuth, useSession } from './session';

/** Opens a built screen only when the user's role allows it. */
function Guarded({ screen }: { screen: ScreenRoute }) {
  const { can, menu } = useSession();
  if (can(screen.code) || screen.also?.some(can)) return <>{screen.element}</>;
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

/**
 * Just signed in or up, still on /login or /register: go where the user was heading (?next=, same-site paths only),
 * or to their home. Done here because signing in swaps the route tree before the form's own navigate runs.
 */
function AfterSignIn({ home }: { home: string }) {
  const next = new URLSearchParams(useLocation().search).get('next');
  return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : home} replace />;
}

/** Signed out, at an address that isn't a public page: portal and staff screens ask for sign-in, anything else is "not found". */
function SignedOutFallback() {
  const { pathname } = useLocation();
  return STAFF_OR_PORTAL.test(pathname) ? <ToLogin /> : <SiteNotFound />;
}
const STAFF_OR_PORTAL = /^\/(my|floor|inspections|admin|setup|maintenance|safety|reports|account)(\/|$)/;

/** The public website (besides home): for visitors and signed-in customers. */
const siteRoutes = (
  <>
    <Route path="/services" element={<ServicesPage />} />
    <Route path="/how-it-works" element={<HowItWorksPage />} />
    <Route path="/about" element={<AboutPage />} />
    <Route path="/contact" element={<ContactPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route path="/terms" element={<TermsPage />} />
  </>
);

/** The routes, inside a boundary that shows an error card (not a blank page) if a page crashes. */
function SafeRoutes() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
      <AppRoutes />
    </ErrorBoundary>
  );
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
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          {siteRoutes}
          <Route path="*" element={<SignedOutFallback />} />
        </Route>
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

  // Customers: their portal (/my), and the public website
  if (session.me.userType === 'customer') {
    return (
      <Routes>
        <Route path="/my" element={<CustomerLayout />}>
          <Route index element={<PortalHomePage />} />
          <Route path="vehicles" element={<MyVehiclesPage />} />
          <Route path="vehicles/:id" element={<MyVehiclePage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="bookings/new" element={<NewBookingPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="account" element={<MyAccountPage />} />
          <Route path="*" element={<Navigate to="/my" replace />} />
        </Route>
        <Route path="/login" element={<AfterSignIn home="/my" />} />
        <Route path="/register" element={<AfterSignIn home="/my" />} />
        <Route element={<SiteLayout />}>
          <Route index element={<HomePage />} />
          {siteRoutes}
        </Route>
        <Route path="*" element={<Navigate to="/my" replace />} />
      </Routes>
    );
  }

  // Staff
  return (
    <Routes>
      <Route path="/login" element={<AfterSignIn home="/" />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route path="/my/*" element={<Navigate to="/" replace />} />
      <Route element={<AppLayout />}>
        {SCREENS.map((s) => (
          <Route key={s.path} path={s.path} element={<Guarded screen={s} />} />
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
        <SafeRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
