import { createContext, useContext } from 'react';

export type Me = {
  userId: number;
  username: string;
  displayName: string;
  designation: string | null;
  role: { roleId: number; name: string };
  isSuperAdmin: boolean;
  permissions: string[];
};

export type MenuNode = {
  code: string;
  name: string;
  icon: string;
  url: string | null;
  kind: 'header' | 'group' | 'link';
  children: MenuNode[];
};

export type AppConfig = {
  appName: string;
  version: string;
  environment: 'development' | 'test' | 'production';
  settings: Record<string, unknown>;
};

export type Session = {
  me: Me;
  menu: MenuNode[];
  config: AppConfig;
  /** True when the user may use the screen or function (super admins may use everything). */
  can: (code: string) => boolean;
};

export const SessionContext = createContext<Session | null>(null);

/** Who is signed in, their menu and permissions, and the app settings. Loaded once by <SessionProvider>. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/** Finds the menu link whose url matches the path (used for screens that are on the menu but not built yet). */
export function findMenuLink(menu: MenuNode[], path: string): MenuNode | undefined {
  for (const node of menu) {
    if (node.kind === 'link' && node.url === path) return node;
    const child = findMenuLink(node.children, path);
    if (child) return child;
  }
  return undefined;
}
