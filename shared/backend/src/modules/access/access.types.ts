/** The signed-in user as every route sees it (req.user). */
export type CurrentUser = {
  userId: number;
  username: string;
  displayName: string;
  designation: string | null;
  roleId: number;
  roleName: string;
  isSuperAdmin: boolean;
  /** Screen and function codes this user may use (public screens included). */
  screens: ReadonlySet<string>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's own extension point
  namespace Express {
    interface Request {
      user?: CurrentUser;
    }
  }
}
