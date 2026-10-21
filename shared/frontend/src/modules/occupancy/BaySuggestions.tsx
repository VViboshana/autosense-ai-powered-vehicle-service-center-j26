import { useState } from 'react';
import { useSession } from '@/app/session';
import { Alert } from '@/components/ui/Form';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BayRelease, BaySuggestion, BaySuggestions as Data, QueuedJob } from './occupancy.types';
import { NextStepPopup, PlateCheckIn } from './PlatePopups';
import './occupancy.css';

/**
 * Bay monitor: when the camera sees a bay occupied and no job is in it, suggest the next vehicle in the queue
 * (GET /api/occupancy/bay-suggestions). It is only a suggestion: staff pick the vehicle that is really there and
 * confirm (function BAY_JOB_CONFIRM), which moves that job to "In bay". The other way round: when a bay with a job
 * turns free, it asks whether the vehicle left; confirming moves the job to "Ready". Shown as small pop-ups in the
 * bottom-right corner that never cover the page's content (they can be minimised); hidden when there is nothing to do.
 * Plate pop-ups and next steps (send to inspection, start it, work done): PlatePopups.tsx.
 */
const STAGE: Record<QueuedJob['stage'], string> = {
  waiting_for_bay: 'waiting for a bay',
  checked_in: 'checked in',
};

export function BaySuggestions({ onConfirmed }: { onConfirmed: () => void }) {
  const { can } = useSession();
  const { data, error, reload } = useApi<Data>('/occupancy/bay-suggestions', undefined, { refreshMs: 5_000 });
  const [hidden, setHidden] = useState<string[]>([]);
  const hide = (key: string) => setHidden((h) => [...h, key]);
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);

  // Only what staff can act on: a parked car while someone is waiting, or a bay that emptied with a job still in it.
  // (A car in a bay with nobody waiting is shown on the bay's tile instead.)
  // A bay with a read plate is worth showing even with nobody waiting: staff see which vehicle is there
  const shown = data ? data.suggestions.filter((s) => !hidden.includes(`b${s.bayId}`) && (data.queue.length > 0 || s.plateStable)) : [];
  const releases = data?.releases.filter((r) => !hidden.includes(`r${r.jobId}`)) ?? [];
  // A read plate whose vehicle is on record but not checked in: check it in straight into the bay
  const plateCheckIns = shown.filter((s) => s.plateVehicle && !s.plateOpenJob);
  const others = shown.filter((s) => !(s.plateVehicle && !s.plateOpenJob));
  const nextSteps = data?.nextSteps.filter((n) => !hidden.includes(`n${n.jobId}-${n.stage}`)) ?? [];
  const total = shown.length + releases.length + nextSteps.length;
  const done = () => { reload(); onConfirmed(); };

  if (error && !data) {
    return (
      <aside className="as-toasts" aria-label="Camera suggestions">
        <div className="as-toast as-toast-error" role="alert">
          <span>Camera suggestions couldn't be loaded.</span>
          <button type="button" className="btn btn-link btn-sm p-0" onClick={reload}>Try again</button>
        </div>
      </aside>
    );
  }
  if (total === 0) return null;

  const items = [
    ...plateCheckIns.map((sg) => (
      <PlateCheckIn key={`p${sg.bayId}`} s={sg} canCheckIn={can('JOB_CHECK_IN') && can('BAY_JOB_CONFIRM')}
        onHide={() => hide(`b${sg.bayId}`)} onDone={done} />
    )),
    ...nextSteps.map((n) => (
      <NextStepPopup key={`n${n.jobId}-${n.stage}`} n={n} can={can} onHide={() => hide(`n${n.jobId}-${n.stage}`)} onDone={done} />
    )),
    ...releases.map((r) => (
      <Release key={`r${r.jobId}`} release={r} canConfirm={can('BAY_JOB_CONFIRM')}
        onHide={() => hide(`r${r.jobId}`)} onConfirmed={done} />
    )),
    ...others.map((sg) => (
      <Suggestion key={sg.bayId} suggestion={sg} queue={data!.queue} canConfirm={can('BAY_JOB_CONFIRM')}
        onHide={() => hide(`b${sg.bayId}`)} onConfirmed={done} />
    )),
  ];
  const visible = all ? items : items.slice(0, 3);

  return (
    <aside className="as-toasts" aria-label="Camera suggestions" aria-live="polite">
      <button type="button" className="as-toasts-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <i className="bi bi-lightbulb" aria-hidden="true" />
        <span>Bay assistant</span>
        <span className="as-toasts-count">{total}</span>
        <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-up'} ms-auto`} aria-hidden="true" />
      </button>
      {open && (
        <>
          <ul className="as-toasts-list">{visible}</ul>
          {items.length > 3 && (
            <button type="button" className="btn btn-link btn-sm as-toasts-more" onClick={() => setAll((a) => !a)}>
              {all ? 'Show fewer' : `Show ${items.length - 3} more`}
            </button>
          )}
        </>
      )}
    </aside>
  );
}

function Release({ release: r, canConfirm, onHide, onConfirmed }: {
  release: BayRelease;
  canConfirm: boolean;
  onHide: () => void;
  onConfirmed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/occupancy/bay-suggestions/release', { bayId: r.bayId, jobId: r.jobId });
      onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="as-sugg as-sugg-release">
      <div className="as-sugg-head">
        <strong>{r.name}</strong>
        <StatusPill tone="success">Looks free</StatusPill>
        <span className="small text-body-secondary">free{r.since ? ` for ${formatDuration(minutesSince(r.since))}` : ''}</span>
      </div>
      <p className="small mb-2">
        <span className="as-mono">{r.registrationNo}</span> · {r.vehicle} ({r.jobNo}) is still in this bay
        {r.bayEnteredAt ? ` since ${formatTime(r.bayEnteredAt)}` : ''}. Has the vehicle left?
      </p>
      <div className="as-sugg-act">
        {canConfirm && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Saving…' : 'Confirm: vehicle left, job ready'}
          </button>
        )}
        <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={onHide}>Not now</button>
      </div>
      {!canConfirm && <p className="small text-body-secondary mb-0 mt-1">Ask a colleague who can confirm vehicles in bays.</p>}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}

function Suggestion({ suggestion: s, queue, canConfirm, onHide, onConfirmed }: {
  suggestion: BaySuggestion;
  queue: QueuedJob[];
  canConfirm: boolean;
  onHide: () => void;
  onConfirmed: () => void;
}) {
  const [jobId, setJobId] = useState<number | null>(s.suggestedJobId ?? queue[0]?.jobId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (jobId === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/occupancy/bay-suggestions/confirm', { bayId: s.bayId, jobId });
      onConfirmed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="as-sugg">
      <div className="as-sugg-head">
        <strong>{s.name}</strong>
        <StatusPill tone="info">Camera suggestion</StatusPill>
        <span className="small text-body-secondary">
          occupied{s.since ? ` for ${formatDuration(minutesSince(s.since))}` : ''}
          {s.overlap !== null && ` · vehicle covers ${Math.round(s.overlap * 100)}%`}
        </span>
      </div>
      {s.plateStable && s.plateText && (
        <p className="small mb-2">
          <i className="bi bi-credit-card-2-front me-1" aria-hidden="true" />Plate read: <b className="as-mono">{s.plateText}</b>
          {s.plateMatched ? ' · matches the vehicle below' : ' · no vehicle waiting has this plate'}
        </p>
      )}

      {queue.length === 0 ? (
        <p className="small mb-0">No vehicle is waiting for a bay. Check the vehicle in first, then confirm it here.</p>
      ) : (
        <div className="as-sugg-act">
          <label className="small" htmlFor={`sugg-${s.bayId}`}>Vehicle in this bay</label>
          <select
            id={`sugg-${s.bayId}`}
            className="form-select form-select-sm"
            value={jobId ?? ''}
            disabled={!canConfirm || busy}
            onChange={(e) => setJobId(Number(e.target.value))}
          >
            {queue.map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {j.registrationNo} · {j.vehicle} · {j.service} ({j.jobNo}, {STAGE[j.stage]} since {formatTime(j.checkedInAt)})
                {j.jobId === s.suggestedJobId ? ' · next in queue' : ''}
              </option>
            ))}
          </select>
          {canConfirm && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || jobId === null} onClick={() => void confirm()}>
              {busy ? 'Moving…' : 'Confirm: move into bay'}
            </button>
          )}
          <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={onHide}>Not now</button>
        </div>
      )}
      {!canConfirm && queue.length > 0 && <p className="small text-body-secondary mb-0 mt-1">Ask a colleague who can confirm vehicles in bays.</p>}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}
