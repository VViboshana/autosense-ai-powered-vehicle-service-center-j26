import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert, Field } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { Role } from './admin.types';

/** Administration › Roles. Shipped roles: System administrator, Staff, Customer. Others are created here. */
export function RolesPage() {
  const { can } = useSession();
  const roles = useApi<Role[]>('/admin/roles');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggle(role: Role) {
    setActionError(null);
    try {
      await apiSend('POST', `/admin/roles/${role.roleId}/status`, { active: !role.active });
      setMessage(`${role.name} is now ${role.active ? 'inactive' : 'active'}.`);
      roles.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  }

  return (
    <>
      <PageHeader
        title="Roles"
        subtitle="A role is a set of screens. Give each person the role that matches their work."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
            Add role
          </button>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          {message && <Alert tone="success">{message}</Alert>}
          {actionError && <Alert>{actionError}</Alert>}
          <Card>
            {roles.error && !roles.data ? (
              <ErrorState inline error={roles.error} onRetry={roles.reload} />
            ) : (
              <div className="table-responsive">
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>For</th>
                      <th className="text-end">Users</th>
                      <th className="text-end">Screens & actions</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {roles.loading || !roles.data
                      ? Array.from({ length: 4 }, (_, i) => (
                          <tr key={i}>{['10rem', '4rem', '2rem', '2rem', '4rem', '8rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}</tr>
                        ))
                      : roles.data.map((r) => (
                          <tr key={r.roleId}>
                            <td>
                              <b className="fw-semibold">{r.name}</b>
                              {r.isSystem && <span className="as-badge ms-2">Shipped</span>}
                              <div className="small text-body-secondary">{r.description}</div>
                            </td>
                            <td><span className={`as-badge${r.audience === 'customer' ? ' brand' : ''}`}>{r.audience === 'staff' ? 'Staff' : 'Customers'}</span></td>
                            <td className="text-end as-num">{r.userCount}</td>
                            <td className="text-end as-num">{r.grantCount}</td>
                            <td><StatusPill tone={r.active ? 'success' : 'muted'}>{r.active ? 'Active' : 'Inactive'}</StatusPill></td>
                            <td className="text-end text-nowrap">
                              {can('ROLE_PERMISSIONS') && (
                                <Link className="btn btn-sm btn-light me-1" to={`/admin/role-permissions?role=${r.roleId}`}>Permissions</Link>
                              )}
                              <button type="button" className="btn btn-sm btn-light me-1" onClick={() => setEditing(r)}>Edit</button>
                              {!r.isSystem && (
                                <button type="button" className="btn btn-sm btn-light" onClick={() => void toggle(r)}>
                                  {r.active ? 'Make inactive' : 'Make active'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      {editing && (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(r, created) => {
            setEditing(null);
            setMessage(created ? `${r.name} was added. Now choose what it can use in Role permissions.` : `${r.name} was saved.`);
            roles.reload();
          }}
        />
      )}
    </>
  );
}

function RoleDialog({ role, onClose, onSaved }: { role: Role | null; onClose: () => void; onSaved: (r: Role, created: boolean) => void }) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fields = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = role
        ? await apiSend<Role>('PUT', `/admin/roles/${role.roleId}`, { name, description })
        : await apiSend<Role>('POST', '/admin/roles', { name, description });
      onSaved(saved, !role);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={role ? `Edit ${role.name}` : 'Add role'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="role-form" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : role ? 'Save' : 'Add role'}</button>
        </>
      }
    >
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form id="role-form" onSubmit={submit} noValidate>
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} disabled={role?.isSystem} hint={role?.isSystem ? 'Shipped roles keep their name.' : 'e.g. Bay operator'} required />
        <Field label="What this role is for" value={description} onChange={(e) => setDescription(e.target.value)} error={fields.description} />
        {!role && <p className="small text-body-secondary mb-0">New roles are for staff. Customers always have the Customer role.</p>}
      </form>
    </Modal>
  );
}
