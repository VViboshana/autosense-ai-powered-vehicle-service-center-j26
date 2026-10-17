import { describe, expect, it } from 'vitest';
import { buildMenu, type ScreenRow } from './menu.js';

const row = (screenCode: string, parentCode: string | null, url: string | null, displayOrder: number): ScreenRow => ({
  screenCode,
  name: screenCode,
  url,
  parentCode,
  icon: 'bi-circle',
  displayOrder,
  showOnMenu: true,
});

const screens: ScreenRow[] = [
  row('DASHBOARD', null, '/', 1),
  row('INSPECTIONS', null, null, 20),
  row('INSPECTION_CREATE', 'INSPECTIONS', '/inspections/new', 21),
  row('INSPECTION_REVIEW', 'INSPECTIONS', '/inspections/review', 22),
  row('MANAGE', null, null, 90),
  row('ADMINISTRATION', 'MANAGE', null, 92),
  row('USERS', 'ADMINISTRATION', '/admin/users', 93),
];

describe('buildMenu', () => {
  it('keeps only the links the role grants, and the headers that still have links', () => {
    const menu = buildMenu(screens, new Set(['DASHBOARD', 'INSPECTION_REVIEW']), false);
    expect(menu.map((n) => n.code)).toEqual(['DASHBOARD', 'INSPECTIONS']);
    expect(menu[1]?.kind).toBe('header');
    expect(menu[1]?.children.map((n) => n.code)).toEqual(['INSPECTION_REVIEW']);
  });

  it('marks a second-level row without a url as an expandable group', () => {
    const menu = buildMenu(screens, new Set(['USERS']), false);
    const manage = menu.find((n) => n.code === 'MANAGE');
    expect(manage?.children[0]).toMatchObject({ code: 'ADMINISTRATION', kind: 'group' });
    expect(manage?.children[0]?.children[0]).toMatchObject({ code: 'USERS', kind: 'link', url: '/admin/users' });
  });

  it('gives a super admin every link', () => {
    const menu = buildMenu(screens, new Set(), true);
    expect(menu.map((n) => n.code)).toEqual(['DASHBOARD', 'INSPECTIONS', 'MANAGE']);
  });

  it('never shows functions (show_on_menu = false)', () => {
    const withFunction = [...screens, { ...row('INSPECTION_CONFIRM', 'INSPECTIONS', null, 24), showOnMenu: false }];
    const menu = buildMenu(withFunction, new Set(['INSPECTION_CONFIRM']), false);
    expect(menu.find((n) => n.code === 'INSPECTIONS')).toBeUndefined();
  });
});
