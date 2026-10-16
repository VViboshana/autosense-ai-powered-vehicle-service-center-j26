/** Shapes returned by /api/admin/* (see backend/src/modules/admin). */
export type UserStatus = 'active' | 'locked' | 'inactive';

export type UserListItem = {
  userId: number;
  username: string;
  displayName: string;
  userType: 'staff' | 'customer';
  designation: string | null;
  roleId: number;
  roleName: string;
  status: UserStatus;
  isSuperAdmin: boolean;
  lastLoginAt: string | null;
};

export type UserDetail = UserListItem & {
  firstName: string;
  lastName: string;
  email: string | null;
  mobile: string | null;
  employeeNo: string | null;
  failedAttempts: number;
  createdAt: string;
};

export type Role = {
  roleId: number;
  name: string;
  description: string;
  audience: 'staff' | 'customer';
  isSystem: boolean;
  active: boolean;
  userCount: number;
  grantCount: number;
};

export type Feature = 'shared' | 'occupancy' | 'damage' | 'maintenance' | 'security';

export type Permission = {
  code: string;
  name: string;
  feature: Feature;
  accessLevel: 'use' | 'manage' | 'admin';
  kind: 'screen' | 'function';
  group: string | null;
  granted: boolean;
};

export type AuditEntry = {
  auditId: number;
  at: string;
  table: string;
  recordId: string;
  target: string | null;
  action: string;
  snapshot: Record<string, unknown>;
  user: { userId: number; name: string; username: string } | null;
};

export const FEATURES: { key: Feature; label: string; icon: string }[] = [
  { key: 'shared', label: 'Service floor & administration', icon: 'bi-building-gear' },
  { key: 'occupancy', label: 'Bay occupancy', icon: 'bi-p-square' },
  { key: 'damage', label: 'Damage assessment', icon: 'bi-clipboard-check' },
  { key: 'maintenance', label: 'Maintenance', icon: 'bi-wrench-adjustable' },
  { key: 'security', label: 'Anomaly & security', icon: 'bi-shield-check' },
];

export const STATUS_PILL: Record<UserStatus, { label: string; tone: 'success' | 'danger' | 'muted' }> = {
  active: { label: 'Active', tone: 'success' },
  locked: { label: 'Locked', tone: 'danger' },
  inactive: { label: 'Inactive', tone: 'muted' },
};
