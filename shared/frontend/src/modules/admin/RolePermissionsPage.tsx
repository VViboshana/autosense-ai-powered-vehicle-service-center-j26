import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { FEATURES, type Permission, type Role } from './admin.types';

const LEVELS = [
  { key: 'use', label: 'Daily work' },
  { key: 'manage', label: 'Feature setup' },
  { key: 'admin', label: 'Administration' },
] as const;

/**
 * Administration › Role permissions: pick a role, tick what it may use. Grouped by feature, then by
 * daily work / setup / administration. "Action" items are buttons inside a screen (e.g. confirm an inspection).
 */
export function RolePermissionsPage() {
  const [params, setParams] = useSearchParams();
  const roles = useApi<Role[]>('/admin/roles');
  const roleId = Number(params.get('role')) || roles.data?.[0]?.roleId || null;
  const data = useApi<{ role: Role; permissions: Permission[] }>(roleId ? `/admin/roles/${roleId}/permissions` : null);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const original = useMemo(() => new Set((data.data?.permissions ?? []).filter((p) => p.granted).map((p) => p.code)), [data.data]);
  useEffect(() => setChecked(new Set(original)), [original]);
  const changes = [...checked].filter((c) => !original.has(c)).length + [...original].filter((c) => !checked.has(c)).length;

  const toggle = (codes: string[], on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const c of codes) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  async function save() {
    if (!roleId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await apiSend('PUT', `/admin/roles/${roleId}/permissions`, { codes: [...checked] });
      setMessage(`Saved. People with this role see the change the next time a screen loads.`);
      data.reload();
      roles.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saving failed.');
    } finally {
      setSaving(false);
    }
  }

  const role = data.data?.role;
  const permissions = data.data?.permissions ?? [];

  return (
    <>
      <PageHeader title="Role permissions" subtitle="Choose what each role can see and do. Super admins always see everything." />
      <div className="app-content">
        <div className="container-fluid">
          <div className="row g-3">
            <div className="col-lg-3">
              <Card title="Roles" icon="bi-person-badge">
                {roles.error ? (
                  <ErrorState inline error={roles.error} onRetry={roles.reload} />
                ) : (
                  <ul className="as-role-list">
                    {(roles.data ?? []).map((r) => (
                      <li key={r.roleId}>
                        <button
                          type="button"
                          aria-current={r.roleId === roleId}
                          onClick={() => {
                            if (changes && !window.confirm('You have unsaved changes. Leave them?')) return;
                            setMessage(null);
                            setParams({ role: String(r.roleId) });
                          }}
                        >
                          <span>
                            {r.name}
                            {!r.active && <span className="text-body-secondary"> (inactive)</span>}
                          </span>
                          <span className={`as-badge${r.audience === 'customer' ? ' brand' : ''}`}>{r.audience === 'staff' ? 'Staff' : 'Customers'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="col-lg-9">
              {message && <Alert tone="success">{message}</Alert>}
              {error && <Alert>{error}</Alert>}
              <Card
                title={role ? role.name : 'Permissions'}
                icon="bi-diagram-3"
                subtitle={role ? `${role.description} · ${role.userCount} user(s)` : undefined}
                actions={
                  role && (
                    <span className="d-flex gap-2">
                      <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(permissions.map((p) => p.code), true)}>Tick all</button>
                      <button type="button" className="btn btn-sm btn-light" onClick={() => toggle(permissions.map((p) => p.code), false)}>Clear all</button>
                    </span>
                  )
                }
              >
                {data.error && !data.data ? (
                  <ErrorState inline error={data.error} onRetry={data.reload} />
                ) : data.loading || !data.data ? (
                  <div className="d-grid gap-3 p-4">{['60%', '45%', '70%', '50%'].map((w) => <Skeleton key={w} width={w} />)}</div>
                ) : (
                  <>
                    {role?.audience === 'customer' && (
                      <div className="px-4 pt-2">
                        <Alert tone="info">Customers always see their vehicle list and account. Tick which parts of a vehicle's page they see.</Alert>
                      </div>
                    )}
                    {FEATURES.map((f) => {
                      const items = permissions.filter((p) => p.feature === f.key);
                      if (items.length === 0) return null;
                      const codes = items.map((p) => p.code);
                      const all = codes.every((c) => checked.has(c));
                      return (
                        <section key={f.key} className="as-perm-feature">
                          <div className="as-perm-head">
                            <h3>
                              <i className={`bi ${f.icon}`} aria-hidden="true" />
                              {f.label}
                            </h3>
                            <button type="button" className="btn btn-sm btn-link p-0" onClick={() => toggle(codes, !all)}>
                              {all ? 'Clear this feature' : 'Tick this feature'}
                            </button>
                          </div>
                          <div className="as-perm-cols">
                            {LEVELS.map((level) => {
                              const inLevel = items.filter((p) => p.accessLevel === level.key);
                              if (inLevel.length === 0) return <div key={level.key} />;
                              return (
                                <div className="as-perm-col" key={level.key}>
                                  <h4>{role?.audience === 'customer' ? 'Vehicle page' : level.label}</h4>
                                  {inLevel.map((p) => (
                                    <label className="as-perm-item" key={p.code}>
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        checked={checked.has(p.code)}
                                        onChange={(e) => toggle([p.code], e.target.checked)}
                                      />
                                      <span>
                                        {p.name}
                                        {p.kind === 'function' && role?.audience === 'staff' && <small> · action{p.group ? ` in ${p.group}` : ''}</small>}
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                    <div className="as-savebar">
                      <span className="small text-body-secondary">{changes === 0 ? 'No unsaved changes' : `${changes} unsaved change${changes === 1 ? '' : 's'}`}</span>
                      <span className="d-flex gap-2">
                        <button type="button" className="btn btn-light" disabled={changes === 0 || saving} onClick={() => setChecked(new Set(original))}>Undo</button>
                        <button type="button" className="btn btn-primary" disabled={changes === 0 || saving} onClick={() => void save()}>
                          {saving ? 'Saving…' : 'Save permissions'}
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
