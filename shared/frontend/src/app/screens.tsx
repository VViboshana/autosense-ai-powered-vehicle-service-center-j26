import type { ReactNode } from 'react';
import { AuditLogPage } from '@/modules/admin/AuditLogPage';
import { RolePermissionsPage } from '@/modules/admin/RolePermissionsPage';
import { RolesPage } from '@/modules/admin/RolesPage';
import { UsersPage } from '@/modules/admin/UsersPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { VehicleRequestsPage } from '@/modules/floor/VehicleRequestsPage';

/**
 * Built staff screens: path -> page, guarded by the screen code from app.screens (database/reference/010_screens.sql).
 * The path must equal the url in app.screens so the menu link opens it.
 *
 * Menu links without an entry here open the "being built" page; add yours here when the page exists.
 * Pages for one module live in src/modules/<module>/ (e.g. src/modules/inspections/ReviewQueuePage.tsx).
 * Customer pages (/my) are routed in App.tsx.
 */
export type ScreenRoute = { code: string; path: string; element: ReactNode };

export const SCREENS: ScreenRoute[] = [
  { code: 'DASHBOARD', path: '/', element: <DashboardPage /> },
  { code: 'VEHICLE_CLAIMS', path: '/floor/vehicle-requests', element: <VehicleRequestsPage /> },
  { code: 'USERS', path: '/admin/users', element: <UsersPage /> },
  { code: 'ROLES', path: '/admin/roles', element: <RolesPage /> },
  { code: 'ROLE_PERMISSIONS', path: '/admin/role-permissions', element: <RolePermissionsPage /> },
  { code: 'AUDIT_LOG', path: '/admin/audit', element: <AuditLogPage /> },
];
