import type { Db } from '../../db/pool.js';
import type { ScreenRow } from './menu.js';

/** Menu rows for one audience (staff or customer). */
export async function listMenuScreens(db: Db, audience: 'staff' | 'customer'): Promise<ScreenRow[]> {
  const { rows } = await db.query<ScreenRow>(
    `SELECT screen_code AS "screenCode", name, url, parent_code AS "parentCode", icon,
            display_order AS "displayOrder", show_on_menu AS "showOnMenu"
     FROM app.screens
     WHERE is_active AND show_on_menu AND audience = $1
     ORDER BY display_order`,
    [audience],
  );
  return rows;
}
