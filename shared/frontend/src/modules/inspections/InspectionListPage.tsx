import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { InspectionListItem, InspectionStatus } from './inspections.types';
import { SEVERITY, STATUS } from './inspections.ui';
import './inspections.css';

const HISTORY_TABS: { key: InspectionStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'awaiting_review', label: 'Waiting for review' },
  { key: 'confirmed', label: 'Confirmed' },
];

/**
 * Inspections › Review queue (INSPECTION_REVIEW): inspections waiting for a technician, oldest first.
 * Inspections › Inspection history (INSPECTION_HISTORY): every inspection, newest first, by status and plate.
 */
export function InspectionListPage({ mode }: { mode: 'review' | 'history' }) {
  const review = mode === 'review';
  const { can } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<InspectionStatus | ''>('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const status = review ? 'awaiting_review' : tab;
  const list = useApi<Page<InspectionListItem>>('/inspections', { status, search, page, pageSize }, { refreshMs: review ? 30_000 : undefined });
  const open = (i: InspectionListItem) => navigate(`/inspections/${i.inspectionId}`);

  return (
    <>
      <PageHeader
        title={review ? 'Review queue' : 'Inspection history'}
        subtitle={review ? 'Check the damage the model found on each inspection, oldest first.' : 'Every damage inspection, newest first.'}
        actions={
          can('INSPECTION_CREATE') && (
            <Link className="btn btn-primary" to="/inspections/new">
              <i className="bi bi-camera me-1" aria-hidden="true" />
              New inspection
            </Link>
          )
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          <Card>
            {!review && (
              <div className="as-tabs" role="tablist">
                {HISTORY_TABS.map((t) => (
                  <button key={t.key || 'all'} type="button" role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setPage(1); }}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <form
              className="as-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(draft.trim());
                setPage(1);
              }}
            >
              <div className="d-flex gap-2 flex-wrap">
                <input
                  className="form-control"
                  style={{ width: '15rem' }}
                  type="search"
                  placeholder="Vehicle no. or inspection no."
                  aria-label="Search by vehicle number or inspection number"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className="btn btn-sm btn-primary px-3">Search</button>
                {search && (
                  <button type="button" className="btn btn-sm btn-light" onClick={() => { setDraft(''); setSearch(''); setPage(1); }}>
                    Clear
                  </button>
                )}
              </div>
            </form>

            {list.error && !list.data ? (
              <ErrorState inline error={list.error} onRetry={list.reload} title="Inspections couldn't be loaded" />
            ) : (
              <div className="table-responsive" style={{ opacity: list.busy && !list.loading ? 0.6 : 1, transition: 'opacity .15s' }}>
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Inspection</th>
                      <th>Vehicle</th>
                      <th>Job</th>
                      <th className="text-end">Photos</th>
                      <th>Damage found</th>
                      <th>Severity</th>
                      <th>{review ? 'Waiting' : 'Status'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 4 }, (_, i) => (
                          <tr key={i}>
                            {['7rem', '8rem', '6rem', '2rem', '7rem', '5rem', '6rem', '1rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}
                          </tr>
                        ))
                      : list.data.records.map((i) => (
                          <tr key={i.inspectionId} style={{ cursor: 'pointer' }} onClick={() => open(i)}>
                            <td className="as-veh">
                              <Link to={`/inspections/${i.inspectionId}`} onClick={(e) => e.stopPropagation()}><b>{i.inspectionNo}</b></Link>
                              <small className="as-num">{formatDate(i.createdAt)} {formatTime(i.createdAt)}</small>
                            </td>
                            <td className="as-veh">
                              <b>{i.registrationNo}</b>
                              <small>{i.vehicle}</small>
                            </td>
                            <td className="as-mono small">{i.jobNo ?? '—'}</td>
                            <td className="as-num text-end">{i.imageCount}</td>
                            <td className="small">
                              {i.detectionCount === 0 ? (
                                <span className="text-body-secondary">None</span>
                              ) : (
                                <>
                                  {i.detectionCount} {i.detectionCount === 1 ? 'region' : 'regions'}
                                  {i.status === 'awaiting_review' && i.pendingCount > 0 && (
                                    <div className="text-body-secondary">{i.pendingCount} to review</div>
                                  )}
                                </>
                              )}
                            </td>
                            <td>
                              {i.overallSeverity ? (
                                <StatusPill tone={SEVERITY[i.overallSeverity].tone}>{SEVERITY[i.overallSeverity].label}</StatusPill>
                              ) : (
                                <span className="small text-body-secondary">No damage</span>
                              )}
                            </td>
                            <td className="small text-nowrap">
                              {review ? (
                                <span className="as-num">{formatDuration(minutesSince(i.createdAt))}</span>
                              ) : (
                                <StatusPill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</StatusPill>
                              )}
                            </td>
                            <td className="text-end"><i className="bi bi-chevron-right text-body-secondary" aria-hidden="true" /></td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {list.data && list.data.records.length === 0 && (
                  <EmptyState
                    icon="bi-clipboard-check"
                    title={search ? 'No inspections match this search' : review ? 'Nothing to review' : 'No inspections yet'}
                    action={!search && can('INSPECTION_CREATE') && <Link className="btn btn-sm btn-primary" to="/inspections/new">New inspection</Link>}
                  >
                    {!search && (review ? 'New inspections appear here as soon as the photos are analysed.' : 'Inspections appear here once photos of a vehicle are analysed.')}
                  </EmptyState>
                )}
              </div>
            )}
            {list.data && <Pagination page={list.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
          </Card>
        </div>
      </div>
    </>
  );
}
