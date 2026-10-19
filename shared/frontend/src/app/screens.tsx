import type { ReactNode } from 'react';
import { AuditLogPage } from '@/modules/admin/AuditLogPage';
import { RolePermissionsPage } from '@/modules/admin/RolePermissionsPage';
import { RolesPage } from '@/modules/admin/RolesPage';
import { UsersPage } from '@/modules/admin/UsersPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { BookingsPage } from '@/modules/floor/BookingsPage';
import { VehicleRequestsPage } from '@/modules/floor/VehicleRequestsPage';
import { DamagePerformancePage } from '@/modules/inspections/DamagePerformancePage';
import { InspectionDetailPage } from '@/modules/inspections/InspectionDetailPage';
import { InspectionListPage } from '@/modules/inspections/InspectionListPage';
import { NewInspectionPage } from '@/modules/inspections/NewInspectionPage';
import { BayMonitorPage } from '@/modules/occupancy/BayMonitorPage';
/**
 * Built staff screens: path -> page, guarded by the screen code from app.screens (database/reference/010_screens.sql).
 * The path must equal the url in app.screens so the menu link opens it.
 *
 * Menu links without an entry here open the "being built" page; add yours here when the page exists.
 * Pages for one module live in src/modules/<module>/ (e.g. src/modules/inspections/ReviewQueuePage.tsx).
 * Customer pages (/my) are routed in App.tsx.
 */
export type ScreenRoute = {
  code: string;
  /** Other codes that also open the page (e.g. a detail page reached from several lists). */
  also?: string[];
  path: string;
  element: ReactNode;
};

export const SCREENS: ScreenRoute[] = [
  { code: 'DASHBOARD', path: '/', element: <DashboardPage /> },
  { code: 'VEHICLE_CLAIMS', path: '/floor/vehicle-requests', element: <VehicleRequestsPage /> },
  { code: 'BOOKINGS', path: '/floor/bookings', element: <BookingsPage /> },
  { code: 'USERS', path: '/admin/users', element: <UsersPage /> },
  { code: 'ROLES', path: '/admin/roles', element: <RolesPage /> },
  { code: 'ROLE_PERMISSIONS', path: '/admin/role-permissions', element: <RolePermissionsPage /> },
  { code: 'AUDIT_LOG', path: '/admin/audit', element: <AuditLogPage /> },
  { code: 'BAY_MONITOR', path: '/floor/bays', element: <BayMonitorPage /> },
  { code: 'INSPECTION_CREATE', path: '/inspections/new', element: <NewInspectionPage /> },
  { code: 'INSPECTION_REVIEW', path: '/inspections/review', element: <InspectionListPage mode="review" /> },
  { code: 'INSPECTION_HISTORY', path: '/inspections', element: <InspectionListPage mode="history" /> },
  {
    code: 'INSPECTION_HISTORY',
    also: ['INSPECTION_REVIEW', 'INSPECTION_CREATE'],
    path: '/inspections/:id',
    element: <InspectionDetailPage />,
  },
  { code: 'DAMAGE_SETTINGS', path: '/setup/damage', element: <DamagePerformancePage /> },
];
