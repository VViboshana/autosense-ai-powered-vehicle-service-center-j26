import { useState } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { ErrorState } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import { formatDuration, formatTime, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { BayRelease, BaySuggestion, BaySuggestions as Data, QueuedJob } from './occupancy.types';
import './occupancy.css';

/**
 * Bay monitor: when the camera sees a bay occupied and no job is in it, suggest the next vehicle in the queue
 * (GET /api/occupancy/bay-suggestions). It is only a suggestion: staff pick the vehicle that is really there and
 * confirm (function BAY_JOB_CONFIRM), which moves that job to "In bay". The other way round: when a bay with a job
 * turns free, it asks whether the vehicle left; confirming moves the job to "Ready". Hidden when there is nothing to suggest.
 */
const STAGE: Record<QueuedJob['stage'], string> = {
  waiting_for_bay: 'waiting for a bay',
  inspected: 'inspected',
  checked_in: 'checked in',
};

export function BaySuggestions({ onConfirmed }: { onConfirmed: () => void }) {
  const { can } = useSession();
  const { data, error, reload } = useApi<Data>('/occupancy/bay-suggestions', undefined, { refreshMs: 15_000 });
  const [hidden, setHidden] = useState<number[]>([]);

  if (error && !data) {
    return <Card icon="bi-lightbulb" title="Suggested by the camera"><ErrorState inline error={error} onRetry={reload} title="Suggestions couldn't be loaded" /></Card>;
  }
  const shown = data?.suggestions.filter((s) => !hidden.includes(s.bayId)) ?? [];
  const releases = data?.releases.filter((r) => !hidden.includes(-r.jobId)) ?? [];
  if (!data || (shown.length === 0 && releases.length === 0)) return null;

  return (
    <Card
      icon="bi-lightbulb"
      title="Suggested by the camera"
      subtitle="Bay changes the camera saw that the job list doesn't show yet. Nothing changes until you confirm."
    >
      <ul className="as-sugg-list">
        {releases.map((r) => (
          <Release
            key={`r${r.jobId}`}
            release={r}
            canConfirm={can('BAY_JOB_CONFIRM')}
            onHide={() => setHidden((h) => [...h, -r.jobId])}
            onConfirmed={() => { reload(); onConfirmed(); }}
          />
        ))}
        {shown.map((s) => (
          <Suggestion
            key={s.bayId}
            suggestion={s}
            queue={data.queue}
            canConfirm={can('BAY_JOB_CONFIRM')}
            onHide={() => setHidden((h) => [...h, s.bayId])}
            onConfirmed={() => { reload(); onConfirmed(); }}
          />
        ))}
      </ul>
    </Card>
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
