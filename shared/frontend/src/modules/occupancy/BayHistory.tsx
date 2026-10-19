import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { formatDate, formatDuration, formatTimeSeconds } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi } from '@/lib/useApi';
import type { BayEvent } from './occupancy.types';
import './occupancy.css';

/**
 * The confirmed state changes of one bay (GET /api/occupancy/bays/:id/events), for the Bay monitor: a band showing
 * which state the bay was in between its last 100 changes, and the paged list of changes with their evidence.
 * Between changes from different video jobs nothing was watching the bay, so that time is shown as "No reading"
 * (a short fixed-width band) and left out of the shares.
 * Changes come from the occupancy service; each is a suggestion from the camera, not a staff-confirmed record.
 */
type State = BayEvent['toState'];
const STATE = {
  occupied: { label: 'Occupied', tone: 'brand' },
  free: { label: 'Free', tone: 'success' },
  uncertain: { label: 'Confirming', tone: 'info' },
} as const;
const STRIP_SIZE = 100;
const GAP_SHARE = 0.03;   // width of a "No reading" band, as a share of the observed time

/** 35 s · 4 min · 1h 05m */
function held(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : formatDuration(s / 60);
}

/**
 * Bands between consecutive changes (oldest first), and the share of the observed time spent in each state. Two
 * changes from different video jobs (or with no job) have unobserved time between them: a 'gap' band.
 */
function bands(newestFirst: BayEvent[]) {
  const events = [...newestFirst].reverse();
  const t = events.map((e) => new Date(e.at).getTime());
  const segments = events.slice(0, -1).map((e, i) => {
    const next = events[i + 1]!;
    const observed = e.videoJobId !== null && e.videoJobId === next.videoJobId;
    return { state: observed ? e.toState : ('gap' as const), from: e.at, to: next.at, ms: t[i + 1]! - t[i]! };
  });
  const total = segments.filter((g) => g.state !== 'gap').reduce((n, g) => n + g.ms, 0);
  const share = (s: State) => (total > 0 ? segments.filter((g) => g.state === s).reduce((n, g) => n + g.ms, 0) / total : 0);
  return { segments, total, first: events[0], last: events[events.length - 1], shares: { occupied: share('occupied'), free: share('free'), uncertain: share('uncertain') } };
}

const at = (iso: string) => `${formatDate(iso)} ${formatTimeSeconds(iso)}`;

export function BayHistory({ bayId, bayName }: { bayId: number; bayName: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const path = `/occupancy/bays/${bayId}/events`;
  const list = useApi<Page<BayEvent>>(path, { page, pageSize }, { refreshMs: 15_000 });
  const strip = useApi<Page<BayEvent>>(path, { page: 1, pageSize: STRIP_SIZE }, { refreshMs: 15_000 });

  return (
    <Card icon="bi-clock-history" title={`History · ${bayName}`} subtitle="Changes confirmed by the occupancy service, newest first">
      {list.error && !list.data ? <ErrorState inline error={list.error} onRetry={list.reload} title="The history couldn't be loaded" />
        : list.loading || !list.data ? <><Skeleton width="100%" /><div className="mt-3"><Skeleton width="80%" /></div><div className="mt-2"><Skeleton width="70%" /></div></>
        : list.data.totalCount === 0 ? (
          <EmptyState icon="bi-clock-history" title="No changes recorded yet">
            Changes appear here once this bay's camera video has been processed.
          </EmptyState>
        ) : (
          <>
            {strip.data && <Band events={strip.data.records} more={strip.data.totalCount > STRIP_SIZE} />}
            <div className="table-responsive mt-3">
              <table className="table as-table mb-0">
                <thead>
                  <tr><th>When</th><th>Change</th><th>Held for</th><th>Vehicle cover</th><th>Evidence</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {list.data.records.map((e, i) => {
                    const newer = list.data!.records[i - 1];
                    return (
                      <tr key={e.eventId}>
                        <td className="small text-nowrap as-num">{at(e.at)}</td>
                        <td className="text-nowrap">
                          {e.fromState ? <StatusPill tone={STATE[e.fromState].tone}>{STATE[e.fromState].label}</StatusPill> : <span className="small text-body-secondary">Start</span>}
                          <i className="bi bi-arrow-right mx-1 text-body-secondary" aria-label="to" />
                          <StatusPill tone={STATE[e.toState].tone}>{STATE[e.toState].label}</StatusPill>
                        </td>
                        <td className="small as-num">
                          {!newer ? (page === 1 ? 'Current state' : '—')
                            : e.videoJobId !== null && newer.videoJobId === e.videoJobId ? held(new Date(newer.at).getTime() - new Date(e.at).getTime())
                            : 'Until the video ended'}
                        </td>
                        <td className="small as-num">{e.overlap === null ? '—' : `${Math.round(e.overlap * 100)}%`}</td>
                        <td className="small text-body-secondary">{e.evidence || '—'}</td>
                        <td className="small">{e.videoJobId ? `Video job #${e.videoJobId}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </>
        )}
    </Card>
  );
}

function Band({ events, more }: { events: BayEvent[]; more: boolean }) {
  const b = bands(events);
  if (b.segments.length === 0 || b.total <= 0 || !b.first || !b.last) return null;
  const summary = (Object.keys(STATE) as State[]).map((s) => `${STATE[s].label} ${Math.round(b.shares[s] * 100)}%`).join(', ');
  return (
    <div>
      <div className="as-hist-strip" role="img" aria-label={`Between ${at(b.first.at)} and ${at(b.last.at)}: ${summary}`}>
        {b.segments.map((g) => (
          <span
            key={g.from}
            className={`as-hist-${g.state}`}
            style={{ flexGrow: g.state === 'gap' ? b.total * GAP_SHARE : g.ms }}
            title={g.state === 'gap'
              ? `No reading: no video was processed for ${held(g.ms)} (${at(g.from)} to ${at(g.to)})`
              : `${STATE[g.state].label} ${formatTimeSeconds(g.from)}–${formatTimeSeconds(g.to)} (${held(g.ms)})`}
          />
        ))}
      </div>
      <div className="as-hist-axis">
        <span>{at(b.first.at)}</span>
        <span>{at(b.last.at)}</span>
      </div>
      <div className="as-hist-shares">
        {(Object.keys(STATE) as State[]).map((s) => (
          <span key={s}><i className={`as-hist-${s}`} aria-hidden="true" />{STATE[s].label} {Math.round(b.shares[s] * 100)}%</span>
        ))}
        {b.segments.some((g) => g.state === 'gap') && <span><i className="as-hist-gap" aria-hidden="true" />No reading</span>}
        <span className="text-body-secondary">
          of {held(b.total)} watched, across the {more ? `last ${events.length}` : `${events.length}`} changes
        </span>
      </div>
    </div>
  );
}
