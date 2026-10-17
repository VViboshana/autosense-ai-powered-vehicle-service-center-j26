import type { CurrentUser } from './access.types.js';

/** What the browser gets about the signed-in user (GET /api/me, and the answer to sign-in and sign-up). */
export function toMe(user: CurrentUser) {
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    designation: user.designation,
    userType: user.userType,
    role: { roleId: user.roleId, name: user.roleName },
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
    permissions: [...user.screens].sort(),
  };
}
