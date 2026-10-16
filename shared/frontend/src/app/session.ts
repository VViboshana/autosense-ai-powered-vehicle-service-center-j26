import { createContext, useContext } from 'react';

export type Me = {
  userId: number;
  username: string;
  displayName: string;
  designation: string | null;
  userType: 'staff' | 'customer';
  role: { roleId: number; name: string };
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
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
  /** needed: no staff account exists yet, so the app shows "Create the administrator". */
  setup: { needed: boolean; keyRequired: boolean };
  settings: Record<string, unknown>;
};

export type PasswordPolicy = { minLength: number; minCharacterTypes: number; rememberLast: number };

export type Session = {
  me: Me;
  menu: MenuNode[];
  config: AppConfig;
  /** True when the user may use the screen or function. */
  can: (code: string) => boolean;
  signOut: () => Promise<void>;
  /** Reloads who is signed in (after sign-in, sign-up or a password change). */
  refresh: () => Promise<void>;
};

export type Auth = {
  config: AppConfig;
  session: Session | null;
  /** Shown on the sign-in page, e.g. "Your session ended". */
  notice: string | null;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}

/** The signed-in user's session. Only use it in screens behind sign-in. */
export function useSession(): Session {
  const { session } = useAuth();
  if (!session) throw new Error('useSession needs a signed-in user');
  return session;
}

export function passwordPolicy(config: AppConfig): PasswordPolicy {
  const p = config.settings['auth.password_policy'] as Partial<PasswordPolicy> | undefined;
  return { minLength: p?.minLength ?? 8, minCharacterTypes: p?.minCharacterTypes ?? 3, rememberLast: p?.rememberLast ?? 3 };
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
