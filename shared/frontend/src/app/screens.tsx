import type { ReactNode } from 'react';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';

/**
 * Built screens: path -> page, guarded by the screen code from app.screens (database/reference/010_screens.sql).
 * The path must equal the url in app.screens so the menu link opens it.
 *
 * Menu links without an entry here open the "being built" page; add yours here when the page exists.
 * Pages for one module live in src/modules/<module>/ (e.g. src/modules/inspections/ReviewQueuePage.tsx).
 */
export type ScreenRoute = { code: string; path: string; element: ReactNode };

export const SCREENS: ScreenRoute[] = [
  { code: 'DASHBOARD', path: '/', element: <DashboardPage /> },
];
