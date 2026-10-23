import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { DrivingCar } from '@/components/ui/Art';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDuration, formatMoney, formatTime } from '@/lib/format';
import { PAGE_SIZES, type Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { JobListItem, JobStage } from './dashboard.types';
import { STAGES } from './stages';

/** "Today's vehicles": every vehicle checked in today and where it is in the service. Server-side paging and filters. */
export function TodayVehicles() {
  const { can } = useSession();
  const [draft, setDraft] = useState({ search: '', stage: '' });
  const [filter, setFilter] = useState({ search: '', stage: '' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, error, loading, busy, reload } = useApi<Page<JobListItem>>(
    '/jobs',
    { scope: 'today', search: filter.search, stage: filter.stage, page, pageSize },
    { refreshMs: 60_000 },
  );

  const apply = () => {
    setFilter(draft);
    setPage(1);
  };
  const clear = () => {
    setDraft({ search: '', stage: '' });
    setFilter({ search: '', stage: '' });
    setPage(1);
  };
  const filtered = Boolean(filter.search || filter.stage);
  const first = data ? (data.pageNo - 1) * data.pageSize + 1 : 0;
  const last = data ? first + data.records.length - 1 : 0;

  return (
    <Card
      icon="bi-car-front"
      title="Today's vehicles"
      labelledBy="today-vehicles"
      subtitle="Every vehicle checked in today and where it is in the service"
      actions={
        can('JOBS') && (
          <Link className="as-more" to="/floor/jobs">
            Open vehicles &amp; jobs <i className="bi bi-arrow-right" aria-hidden="true" />
          </Link>
        )
      }
    >
      <form
        className="as-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div className="d-flex gap-2 flex-wrap">
          <input
            className="form-control"
            style={{ width: '15rem' }}
            type="search"
            placeholder="Vehicle no. or customer"
            aria-label="Filter by vehicle number or customer"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          />
          <select
            className="form-select"
            style={{ width: '11rem' }}
            aria-label="Stage"
            value={draft.stage}
            onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
          >
            <option value="">All stages</option>
            {(Object.keys(STAGES) as JobStage[]).map((s) => (
              <option key={s} value={s}>
                {STAGES[s].label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-sm btn-primary px-3">
            Search
          </button>
          <button type="button" className="btn btn-sm btn-light" onClick={clear}>
            Clear
          </button>
        </div>
      </form>

      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} title="Vehicles couldn't be loaded" />
      ) : (
        <div className="table-responsive" style={{ opacity: busy && !loading ? 0.6 : 1, transition: 'opacity .15s' }}>
          <table className="table as-table">
            <thead>
              <tr>
                <th>Vehicle</th>
                <th>Customer</th>
                <th>Service</th>
                <th>Stage</th>
                <th>Bay</th>
                <th>Arrived</th>
                <th className="text-end">Est. time</th>
                <th className="text-end">Estimate (LKR)</th>
                <th>Advisor</th>
              </tr>
            </thead>
            <tbody>
              {loading || !data
                ? Array.from({ length: 4 }, (_, i) => (
                    <tr key={i}>
                      {['7rem', '8rem', '6rem', '5rem', '3rem', '3rem', '3.5rem', '5rem', '4rem'].map((w, j) => (
                        <td key={j}>
                          <Skeleton width={w} className={j >= 6 && j <= 7 ? 'ms-auto' : ''} />
                        </td>
                      ))}
                    </tr>
                  ))
                : data.records.map((job) => {
                    const stage = STAGES[job.stage];
                    return (
                      <tr key={job.jobId}>
                        <td className="as-veh">
                          <b>{job.registrationNo}</b>
                          <small>{job.vehicle}</small>
                        </td>
                        <td>{job.customer ?? '—'}</td>
                        <td>{job.service}</td>
                        <td>
                          <StatusPill tone={stage.tone}>{stage.label}</StatusPill>
                          <div className="as-stages" aria-hidden="true">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <i key={n} className={n <= stage.step ? 'on' : ''} />
                            ))}
                          </div>
                        </td>
                        <td className={job.bay ? '' : 'text-body-secondary'}>{job.bay ?? '—'}</td>
                        <td className="as-num">{formatTime(job.checkedInAt)}</td>
                        <td className={`text-end as-num${job.estimatedMinutes === null ? ' text-body-secondary' : ''}`}>
                          {job.estimatedMinutes === null ? 'Pending' : formatDuration(job.estimatedMinutes)}
                        </td>
                        <td className={`text-end as-num${job.estimateLkr === null ? ' text-body-secondary' : ''}`}>
                          {job.estimateLkr === null ? 'Pending' : formatMoney(job.estimateLkr)}
                        </td>
                        <td>{job.advisor ?? '—'}</td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {data && data.records.length === 0 && (
            <EmptyState icon="bi-car-front" art={filtered ? undefined : <DrivingCar />} title={filtered ? 'No vehicles match these filters' : 'No vehicles checked in yet today'}>
              {filtered ? 'Change the search or clear the filters.' : "Vehicles appear here as soon as they're checked in."}
            </EmptyState>
          )}
        </div>
      )}

      {data && data.totalCount > 0 && (
        <div className="as-grid-foot">
          <span className="as-num">
            Showing {first}–{last} of {data.totalCount}
          </span>
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <label className="d-flex align-items-center gap-2">
              Rows
              <select
                className="form-select form-select-sm"
                style={{ width: 'auto' }}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <nav aria-label="Pages">
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item${data.pageNo <= 1 ? ' disabled' : ''}`}>
                  <button type="button" className="page-link" aria-label="Previous page" onClick={() => setPage(data.pageNo - 1)}>
                    ‹
                  </button>
                </li>
                {Array.from({ length: data.noOfPages }, (_, i) => i + 1)
                  .filter((n) => Math.abs(n - data.pageNo) <= 2 || n === 1 || n === data.noOfPages)
                  .map((n) => (
                    <li key={n} className={`page-item${n === data.pageNo ? ' active' : ''}`}>
                      <button type="button" className="page-link" onClick={() => setPage(n)} aria-current={n === data.pageNo ? 'page' : undefined}>
                        {n}
                      </button>
                    </li>
                  ))}
                <li className={`page-item${data.pageNo >= data.noOfPages ? ' disabled' : ''}`}>
                  <button type="button" className="page-link" aria-label="Next page" onClick={() => setPage(data.pageNo + 1)}>
                    ›
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      )}
    </Card>
  );
}
