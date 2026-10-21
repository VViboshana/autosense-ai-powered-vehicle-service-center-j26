import { useState } from 'react';
import { Alert } from '@/components/ui/Form';
import { ApiError, apiSend } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { STAGES } from '@/modules/dashboard/stages';
import type { JobStage } from '@/modules/dashboard/dashboard.types';
import type { BaySuggestion } from './occupancy.types';

/**
 * The contents of the number-plate pop-up (BaySuggestions.tsx › PlateAssistant):
 * - PlateCheckIn: the plate belongs to a vehicle on record that is not checked in. With a booking for today, one click
 *   checks it in from the booking (confirming it if still pending) and moves it into the bay; otherwise as a walk-in.
 * - PlateInfo: the vehicle already has a job elsewhere in the flow, or the plate is not on record.
 * Nothing changes until staff click.
 */
type Service = { serviceTypeId: number; name: string; defaultMinutes: number };

export function PlateCheckIn({ s, canCheckIn, onHide, onDone }: { s: BaySuggestion; canCheckIn: boolean; onHide: () => void; onDone: () => void }) {
  const v = s.plateVehicle!;
  const b = s.plateBooking;
  const services = useApi<Service[]>(b || !canCheckIn ? null : '/jobs/service-types');
  const [serviceTypeId, setServiceTypeId] = useState<number | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ inBay: boolean; reason?: string }>('POST', '/occupancy/bay-suggestions/check-in',
        b ? { bayId: s.bayId, bookingId: b.bookingId } : { bayId: s.bayId, vehicleId: v.vehicleId, serviceTypeId });
      if (!res.inBay) setError(`Checked in, but not moved into the bay: ${res.reason ?? 'the bay was taken'}. It is waiting in the queue.`);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="as-plate-pop-body">
      <p className="mb-1"><b>{s.name}</b> · <b className="as-mono">{s.plateText}</b></p>
      <p className="small mb-2">
        {v.vehicle}{v.customer ? ` · ${v.customer}` : ''} is in the bay but not checked in.
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
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!b && serviceTypeId === '')} onClick={() => void checkIn()}>
            {busy ? 'Checking in…' : b ? `Check in & move into ${s.name}` : `Check in as walk-in & move into ${s.name}`}
          </button>
          <button type="button" className="btn btn-light btn-sm" disabled={busy} onClick={onHide}>Not now</button>
        </div>
      )}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
    </div>
  );
}

export function PlateInfo({ s, onHide }: { s: BaySuggestion; onHide: () => void }) {
  const job = s.plateOpenJob;
  const stage = job ? STAGES[job.stage as JobStage] : null;
  return (
    <div className="as-plate-pop-body">
      <p className="mb-1"><b>{s.name}</b> · <b className="as-mono">{s.plateText}</b></p>
      <p className="small mb-2">
        {s.plateVehicle && job
          ? <>{s.plateVehicle.vehicle} already has job <b>{job.jobNo}</b> ({stage?.label ?? job.stage}). If that is wrong, check the vehicle on Vehicles &amp; jobs.</>
          : <>This plate is not on record. If the customer is new, they add the vehicle in their portal and staff approve it; it can then be checked in.</>}
      </p>
      <button type="button" className="btn btn-light btn-sm" onClick={onHide}>Dismiss</button>
    </div>
  );
}
