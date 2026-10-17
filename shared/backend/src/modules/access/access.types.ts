/** The signed-in user as every route sees it (req.user). */
export type CurrentUser = {
  userId: number;
  username: string;
  displayName: string;
  designation: string | null;
  userType: 'staff' | 'customer';
  /** Set for customers only. Customer routes filter every query by it; never take a customer id from the request. */
  customerId: number | null;
  roleId: number;
  roleName: string;
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  /** Screen and function codes this user may use (public screens of their audience included). */
  screens: ReadonlySet<string>;
  /** The sign-in session this request belongs to. */
  sessionId: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      user?: CurrentUser;
    }
  }
}
