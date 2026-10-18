/** A row of app.screens, as the menu builder needs it. */
export type ScreenRow = {
  screenCode: string;
  name: string;
  url: string | null;
  parentCode: string | null;
  icon: string;
  displayOrder: number;
  showOnMenu: boolean;
};

export type MenuNode = {
  code: string;
  name: string;
  icon: string;
  url: string | null;
  /** header: section title (top level, no url) · group: expandable (lower level, no url) · link: opens a screen */
  kind: 'header' | 'group' | 'link';
  children: MenuNode[];
};

/**
 * Builds the sidebar for one user from the screen registry: only links the user may open, and only the headers and
 * groups that still have something in them. Pure function, so it is unit-tested without a database.
 */
export function buildMenu(screens: ScreenRow[], allowed: ReadonlySet<string>, isSuperAdmin: boolean): MenuNode[] {
  const visible = screens.filter((s) => s.showOnMenu).sort((a, b) => a.displayOrder - b.displayOrder);
  const byParent = new Map<string | null, ScreenRow[]>();
  for (const s of visible) {
    const list = byParent.get(s.parentCode) ?? [];
    list.push(s);
    byParent.set(s.parentCode, list);
  }

  const build = (parent: string | null, depth: number): MenuNode[] => {
    if (depth > 3) return []; // three levels at most
    const nodes: MenuNode[] = [];
    for (const s of byParent.get(parent) ?? []) {
      if (s.url) {
        if (isSuperAdmin || allowed.has(s.screenCode)) {
          nodes.push({ code: s.screenCode, name: s.name, icon: s.icon, url: s.url, kind: 'link', children: [] });
        }
        continue;
      }
      const children = build(s.screenCode, depth + 1);
      if (children.length > 0) {
        nodes.push({ code: s.screenCode, name: s.name, icon: s.icon, url: null, kind: depth === 1 ? 'header' : 'group', children });
      }
    }
    return nodes;
  };

  return build(null, 1);
}
