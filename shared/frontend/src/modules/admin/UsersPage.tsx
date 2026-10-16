import { useState, type ChangeEvent, type FormEvent } from 'react';
import { passwordPolicy, useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { Alert, Field, PasswordField, PasswordRules, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors, fieldMessages } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import { STATUS_PILL, type Role, type UserDetail, type UserListItem } from './admin.types';

type Dialog = { kind: 'create' } | { kind: 'edit'; userId: number } | { kind: 'password'; user: UserListItem } | null;

/** Administration › Users: staff accounts (created here) and customer accounts (created by sign-up). */
export function UsersPage() {
  const { me } = useSession();
  const [draft, setDraft] = useState({ search: '', userType: '', status: '' });
  const [filter, setFilter] = useState(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const list = useApi<Page<UserListItem>>('/admin/users', { ...filter, page, pageSize });
  const roles = useApi<Role[]>('/admin/roles');

  async function statusAction(user: UserListItem, action: 'activate' | 'deactivate' | 'unlock') {
    setActionError(null);
    try {
      await apiSend('POST', `/admin/users/${user.userId}/status`, { action });
      setMessage(`${user.displayName} is now ${action === 'deactivate' ? 'inactive' : 'active'}.`);
      list.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  }

  const done = (text: string) => {
    setDialog(null);
    setMessage(text);
    list.reload();
  };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Staff accounts are created here. Customers create their own accounts."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setDialog({ kind: 'create' })}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" />
            Add staff user
          </button>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {message && <Alert tone="success">{message}</Alert>}
          {actionError && <Alert>{actionError}</Alert>}
          <Card>
            <form
              className="as-toolbar"
              style={{ borderTop: 0, borderRadius: 'var(--as-radius) var(--as-radius) 0 0' }}
              onSubmit={(e) => {
                e.preventDefault();
                setFilter(draft);
                setPage(1);
              }}
            >
              <div className="d-flex gap-2 flex-wrap">
                <input className="form-control" style={{ width: '15rem' }} type="search" placeholder="Name, username or email" aria-label="Search users" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
                <select className="form-select" style={{ width: '11.5rem' }} aria-label="Type" value={draft.userType} onChange={(e) => setDraft({ ...draft, userType: e.target.value })}>
                  <option value="">Staff & customers</option>
                  <option value="staff">Staff</option>
                  <option value="customer">Customers</option>
                </select>
                <select className="form-select" style={{ width: '9rem' }} aria-label="Status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                  <option value="">Any status</option>
                  <option value="active">Active</option>
                  <option value="locked">Locked</option>
                  <option value="inactive">Inactive</option>
                </select>
                <button type="submit" className="btn btn-sm btn-primary px-3">Search</button>
                <button type="button" className="btn btn-sm btn-light" onClick={() => { const empty = { search: '', userType: '', status: '' }; setDraft(empty); setFilter(empty); setPage(1); }}>
                  Clear
                </button>
              </div>
            </form>

            {list.error && !list.data ? (
              <ErrorState inline error={list.error} onRetry={list.reload} />
            ) : (
              <div className="table-responsive">
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Username</th>
                      <th>Type</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Last sign-in</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 5 }, (_, i) => (
                          <tr key={i}>
                            {['9rem', '7rem', '4rem', '7rem', '4rem', '6rem', '2rem'].map((w, j) => (
                              <td key={j}><Skeleton width={w} /></td>
                            ))}
                          </tr>
                        ))
                      : list.data.records.map((u) => (
                          <tr key={u.userId}>
                            <td>
                              <b className="fw-semibold">{u.displayName}</b>
                              {u.designation && <div className="small text-body-secondary">{u.designation}</div>}
                            </td>
                            <td className="as-mono">{u.username}</td>
                            <td><span className={`as-badge${u.userType === 'customer' ? ' brand' : ''}`}>{u.userType === 'staff' ? 'Staff' : 'Customer'}</span></td>
                            <td>
                              {u.roleName}
                              {u.isSuperAdmin && <span className="as-badge ms-1" title="Can use every staff screen">Super admin</span>}
                            </td>
                            <td><StatusPill tone={STATUS_PILL[u.status].tone}>{STATUS_PILL[u.status].label}</StatusPill></td>
                            <td className="as-num small">{u.lastLoginAt ? `${formatDate(u.lastLoginAt)} ${formatTime(u.lastLoginAt)}` : 'Never'}</td>
                            <td className="text-end">
                              <Dropdown label={`Actions for ${u.displayName}`} buttonClassName="btn btn-sm btn-light" trigger={<i className="bi bi-three-dots" aria-hidden="true" />}>
                                {(close) => (
                                  <>
                                    <button type="button" className="dropdown-item" onClick={() => { close(); setDialog({ kind: 'edit', userId: u.userId }); }}>
                                      <i className="bi bi-pencil me-2" aria-hidden="true" />Edit
                                    </button>
                                    <button type="button" className="dropdown-item" onClick={() => { close(); setDialog({ kind: 'password', user: u }); }}>
                                      <i className="bi bi-key me-2" aria-hidden="true" />Reset password
                                    </button>
                                    <div className="dropdown-divider" />
                                    {u.status === 'locked' && (
                                      <button type="button" className="dropdown-item" onClick={() => { close(); void statusAction(u, 'unlock'); }}>
                                        <i className="bi bi-unlock me-2" aria-hidden="true" />Unlock
                                      </button>
                                    )}
                                    {u.status === 'inactive' ? (
                                      <button type="button" className="dropdown-item" onClick={() => { close(); void statusAction(u, 'activate'); }}>
                                        <i className="bi bi-person-check me-2" aria-hidden="true" />Make active
                                      </button>
                                    ) : (
                                      <button type="button" className="dropdown-item text-danger" disabled={u.userId === me.userId} onClick={() => { close(); void statusAction(u, 'deactivate'); }}>
                                        <i className="bi bi-person-dash me-2" aria-hidden="true" />Make inactive
                                      </button>
                                    )}
                                  </>
                                )}
                              </Dropdown>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {list.data && list.data.records.length === 0 && <EmptyState icon="bi-people" title="No users match these filters" />}
              </div>
            )}
            {list.data && <Pagination page={list.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
          </Card>
        </div>
      </div>

      {dialog?.kind === 'create' && <UserDialog roles={roles.data ?? []} onClose={() => setDialog(null)} onSaved={(u) => done(`${u.displayName} can now sign in as ${u.username}.`)} />}
      {dialog?.kind === 'edit' && <UserDialog roles={roles.data ?? []} userId={dialog.userId} onClose={() => setDialog(null)} onSaved={(u) => done(`${u.displayName} was saved.`)} />}
      {dialog?.kind === 'password' && <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onSaved={() => done(`New password set for ${dialog.user.displayName}. Their other sessions were signed out.`)} />}
    </>
  );
}

function UserDialog({ roles, userId, onClose, onSaved }: { roles: Role[]; userId?: number; onClose: () => void; onSaved: (u: UserDetail) => void }) {
  const { config } = useSession();
  const existing = useApi<UserDetail>(userId ? `/admin/users/${userId}` : null);
  const editing = userId !== undefined;
  const [form, setForm] = useState<Record<string, string> | null>(editing ? null : {
    username: '', firstName: '', lastName: '', email: '', mobile: '', employeeNo: '', designation: '', roleId: '', password: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const loaded = existing.data;
  if (editing && loaded && !form) {
    setForm({
      firstName: loaded.firstName, lastName: loaded.lastName, email: loaded.email ?? '', mobile: loaded.mobile ?? '',
      employeeNo: loaded.employeeNo ?? '', designation: loaded.designation ?? '', roleId: String(loaded.roleId),
    });
  }
  const audience = editing ? loaded?.userType ?? 'staff' : 'staff';
  const choices = roles.filter((r) => r.audience === audience && (r.active || String(r.roleId) === form?.roleId));
  const fields = fieldErrors(error);
  const set = (key: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => form && setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const saved = editing
        ? await apiSend<UserDetail>('PUT', `/admin/users/${userId}`, { ...form, roleId: Number(form.roleId) })
        : await apiSend<UserDetail>('POST', '/admin/users', { ...form, roleId: Number(form.roleId) });
      onSaved(saved);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={editing ? `Edit ${loaded?.displayName ?? 'user'}` : 'Add staff user'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy || !form}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add user'}
          </button>
        </>
      }
    >
      {existing.error && <Alert>{existing.error.message}</Alert>}
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      {!form ? (
        <Skeleton width="60%" />
      ) : (
        <form id="user-form" onSubmit={submit} noValidate>
          {!editing && <Field label="Username" value={form.username} onChange={set('username')} error={fields.username} hint="Used to sign in, e.g. sahan.kumara" autoComplete="off" required />}
          {editing && <p className="small text-body-secondary">Username <span className="as-mono">{loaded?.username}</span> · {audience === 'customer' ? 'customer account' : 'staff account'}</p>}
          <div className="row g-2">
            <div className="col-sm-6"><Field label="First name" value={form.firstName} onChange={set('firstName')} error={fields.firstName} required /></div>
            <div className="col-sm-6"><Field label="Last name" value={form.lastName} onChange={set('lastName')} error={fields.lastName} /></div>
          </div>
          <SelectField label="Role" value={form.roleId} onChange={set('roleId')} error={fields.roleId} required>
            <option value="">Choose a role…</option>
            {choices.map((r) => (
              <option key={r.roleId} value={r.roleId}>{r.name}{r.active ? '' : ' (inactive)'}</option>
            ))}
          </SelectField>
          {audience === 'staff' && (
            <div className="row g-2">
              <div className="col-sm-6"><Field label="Designation" value={form.designation} onChange={set('designation')} error={fields.designation} /></div>
              <div className="col-sm-6"><Field label="Employee no." value={form.employeeNo} onChange={set('employeeNo')} error={fields.employeeNo} /></div>
            </div>
          )}
          <div className="row g-2">
            <div className="col-sm-6"><Field label="Email" type="email" value={form.email} onChange={set('email')} error={fields.email} /></div>
            <div className="col-sm-6"><Field label="Mobile" value={form.mobile} onChange={set('mobile')} error={fields.mobile} /></div>
          </div>
          {!editing && (
            <>
              <PasswordField label="Password" value={form.password ?? ''} onChange={set('password')} problems={fieldMessages(error, 'password')} autoComplete="new-password" />
              <PasswordRules policy={passwordPolicy(config)} password={form.password ?? ''} />
              <p className="small text-body-secondary mb-0">Give the password to the user in person. They can change it under My account.</p>
            </>
          )}
        </form>
      )}
    </Modal>
  );
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: UserListItem; onClose: () => void; onSaved: () => void }) {
  const { config } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/admin/users/${user.userId}/reset-password`, { password });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reset password for ${user.displayName}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="reset-form" className="btn btn-primary" disabled={busy || !password}>{busy ? 'Saving…' : 'Set password'}</button>
        </>
      }
    >
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form id="reset-form" onSubmit={submit} noValidate>
        <PasswordField label="New password" value={password} onChange={(e) => setPassword(e.target.value)} problems={fieldMessages(error, 'password')} autoComplete="new-password" />
        <PasswordRules policy={passwordPolicy(config)} password={password} />
        <p className="small text-body-secondary mb-0">This also unlocks the account and signs the user out everywhere.</p>
      </form>
    </Modal>
  );
}
