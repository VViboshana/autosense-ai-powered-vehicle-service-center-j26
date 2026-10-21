import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Form';
import { StatusPill } from '@/components/ui/StatusPill';
import { ApiError, apiSend } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { BaySuggestion, NextStep } from './occupancy.types';

/**
 * Pop-ups driven by the number plate the camera read, and the next step for vehicles in a bay (Bay monitor corner):
 * - PlateCheckIn: the plate belongs to a vehicle on record that is not checked in. With a booking for today: one click
 *   checks it in from the booking (confirming it if still pending) and moves it into the bay; otherwise as a walk-in.
 * - NextStepPopup: a vehicle in a bay -> send to damage inspection; waiting for inspection -> start it; inspected -> work done.
 * Each waits for staff; nothing changes until they click.
 */
type Service = { serviceTypeId: number; name: string; defaultMinutes: number };

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(method: 'POST', path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ inBay?: boolean; reason?: string }>(method, path, body);
      if (res && res.inBay === false) setError(`Checked in, but not moved into the bay: ${res.reason ?? 'the bay was taken'}. It is waiting in the queue.`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function PlateCheckIn({ s, canCheckIn, onHide, onDone }: { s: BaySuggestion; canCheckIn: boolean; onHide: () => void; onDone: () => void }) {
  const v = s.plateVehicle!;
  const b = s.plateBooking;
  const services = useApi<Service[]>(b || !canCheckIn ? null : '/jobs/service-types');
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>('');
  const { busy, error, run } = useAction(onDone);

  return (
    <li className="as-sugg as-sugg-plate">
      <div className="as-sugg-head">
        <strong>{s.name}</strong>
        <StatusPill tone="info">Plate read</StatusPill>
        <b className="as-mono">{s.plateText}</b>
      </div>
      <p className="small mb-2">
        <b className="as-mono">{v.registrationNo}</b> · {v.vehicle}{v.customer ? ` · ${v.customer}` : ''} is in the bay but not checked in.
        {b ? <> Booking <b>{b.bookingNo}</b> today at {b.slotTime}, {b.service}{b.status === 'pending' ? ' (not confirmed yet: checking in confirms it)' : ''}.</>
          : ' No booking for today.'}
      </p>
      {!canCheckIn ? (
        <p className="small text-body-secondary mb-0">Ask a colleague who can check vehicles in and confirm bays.</p>
      ) : (
        <div className="as-sugg-act">
          {!b && (
            <select className="form-select form-select-sm" aria-label="Service" value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value === '' ? '' : Number(e.target.value))}>
              <option value="">Service…</option>
              {(services.data ?? []).map((t) => <option key={t.serviceTypeId} value={t.serviceTypeId}>{t.name}</option>)}
            </select>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!b && serviceTypeId === '')}
            onClick={() => void run('POST', '/occupancy/bay-suggestions/check-in',
              b ? { bayId: s.bayId, bookingId: b.bookingId } : { bayId: s.bayId, vehicleId: v.vehicleId, serviceTypeId })}>
            {busy ? 'Checking in…' : b ? `Check in & move into ${s.name}` : `Check in as walk-in & move into ${s.name}`}
          </button>
          <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={onHide}>Not now</button>
        </div>
      )}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}

const STEP = {
  in_bay: { pill: 'In bay', tone: 'brand', text: 'is in the bay. Next: damage inspection.' },
  inspecting: { pill: 'Damage inspection', tone: 'info', text: 'is waiting for its damage inspection.' },
  inspected: { pill: 'Inspected', tone: 'success', text: 'has a confirmed damage inspection. Next: finish the work.' },
} as const;

export function NextStepPopup({ n, can, onHide, onDone }: { n: NextStep; can: (code: string) => boolean; onHide: () => void; onDone: () => void }) {
  const { busy, error, run } = useAction(onDone);
  const step = STEP[n.stage];
  const canBay = can('BAY_JOB_CONFIRM');
  return (
    <li className="as-sugg as-sugg-next">
      <div className="as-sugg-head">
        <strong>{n.bayName}</strong>
        <StatusPill tone={step.tone}>{step.pill}</StatusPill>
        {n.plateLinked && <span className="small text-body-secondary"><i className="bi bi-credit-card-2-front me-1" aria-hidden="true" />linked by plate</span>}
      </div>
      <p className="small mb-2"><b className="as-mono">{n.registrationNo}</b> · {n.vehicle} ({n.jobNo}) {step.text}</p>
      <div className="as-sugg-act">
        {n.stage === 'in_bay' && canBay && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run('POST', `/jobs/${n.jobId}/send-to-inspection`)}>
              <i className="bi bi-clipboard-check me-1" aria-hidden="true" />Send to damage inspection
            </button>
            <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={() => void run('POST', `/jobs/${n.jobId}/back-to-queue`)}>Not this vehicle</button>
          </>
        )}
        {n.stage === 'inspecting' && can('INSPECTION_CREATE') && (
          <Link className="btn btn-primary btn-sm" to={`/inspections/new?job=${n.jobId}`}>
            <i className="bi bi-camera me-1" aria-hidden="true" />Start inspection
          </Link>
        )}
        {n.stage === 'inspected' && (canBay || can('INSPECTION_CONFIRM')) && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run('POST', `/jobs/${n.jobId}/work-done`)}>
            <i className="bi bi-check2-circle me-1" aria-hidden="true" />Work done
          </button>
        )}
        <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={onHide}>Not now</button>
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </li>
  );
}
