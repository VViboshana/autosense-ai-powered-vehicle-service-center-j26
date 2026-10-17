import { Fragment, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate, formatTime } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { AuditEntry } from './admin.types';

const ACTIONS: Record<string, string> = {
  signed_in: 'Signed in',
  signed_out: 'Signed out',
  sign_in_failed: 'Wrong password',
  locked: 'Account locked',
  unlocked: 'Unlocked',
  registered: 'Signed up',
  created: 'Created',
  updated: 'Changed',
  activated: 'Made active',
  deactivated: 'Made inactive',
  password_changed: 'Changed own password',
  password_reset: 'Password reset',
  permissions_changed: 'Permissions changed',
  requested: 'Vehicle requested',
  approved: 'Request approved',
  rejected: 'Request rejected',
};

const TABLES: Record<string, string> = {
  'app.users': 'User',
  'app.roles': 'Role',
  'app.role_screens': 'Role',
  'workshop.vehicle_claims': 'Vehicle request',
};

/** Administration › Audit log: sign-ins and every change to users, roles, permissions and vehicle requests. */
export function AuditLogPage() {
  const [draft, setDraft] = useState({ search: '', from: '', to: '' });
  const [filter, setFilter] = useState(draft);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [open, setOpen] = useState<number | null>(null);
  const log = useApi<Page<AuditEntry>>('/admin/audit', { ...filter, page, pageSize });

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who did what, newest first. Entries can't be changed or deleted." />
      <div className="app-content">
        <div className="container-fluid">
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
              <div className="d-flex gap-2 flex-wrap align-items-center">
                <input className="form-control" style={{ width: '13rem' }} type="search" placeholder="Action, e.g. locked" aria-label="Search actions" value={draft.search} onChange={(e) => setDraft({ ...draft, search: e.target.value })} />
                <label className="small text-body-secondary" htmlFor="audit-from">From</label>
                <input id="audit-from" className="form-control" style={{ width: '10rem' }} type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
                <label className="small text-body-secondary" htmlFor="audit-to">To</label>
                <input id="audit-to" className="form-control" style={{ width: '10rem' }} type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
                <button type="submit" className="btn btn-sm btn-primary px-3">Search</button>
                <button type="button" className="btn btn-sm btn-light" onClick={() => { const empty = { search: '', from: '', to: '' }; setDraft(empty); setFilter(empty); setPage(1); }}>Clear</button>
              </div>
            </form>
            {log.error && !log.data ? (
              <ErrorState inline error={log.error} onRetry={log.reload} />
            ) : (
              <div className="table-responsive">
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Who</th>
                      <th>What</th>
                      <th>On</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {log.loading || !log.data
                      ? Array.from({ length: 6 }, (_, i) => <tr key={i}>{['7rem', '8rem', '7rem', '9rem', '2rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}</tr>)
                      : log.data.records.map((a) => (
                          <Fragment key={a.auditId}>
                            <tr>
                              <td className="as-num text-nowrap">{formatDate(a.at)} {formatTime(a.at)}</td>
                              <td>{a.user ? a.user.name : <span className="text-body-secondary">Not signed in</span>}</td>
                              <td>{ACTIONS[a.action] ?? a.action}</td>
                              <td>
                                {TABLES[a.table] ?? a.table} <span className="as-mono text-body-secondary">#{a.recordId}</span>
                                {a.target && <span className="text-body-secondary"> · {a.target}</span>}
                              </td>
                              <td className="text-end">
                                {Object.keys(a.snapshot).length > 0 && (
                                  <button type="button" className="btn btn-sm btn-light" aria-expanded={open === a.auditId} onClick={() => setOpen(open === a.auditId ? null : a.auditId)}>
                                    Details
                                  </button>
                                )}
                              </td>
                            </tr>
                            {open === a.auditId && (
                              <tr>
                                <td colSpan={5}>
                                  <pre className="as-mono small mb-0" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(a.snapshot, null, 2)}</pre>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                  </tbody>
                </table>
                {log.data && log.data.records.length === 0 && <EmptyState icon="bi-clock-history" title="Nothing recorded for these filters" />}
              </div>
            )}
            {log.data && <Pagination page={log.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
          </Card>
        </div>
      </div>
    </>
  );
}
