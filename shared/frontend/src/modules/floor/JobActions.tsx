import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Alert, Field, SelectField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import type { JobForecast, JobStage } from '@/modules/dashboard/dashboard.types';

/**
 * The buttons that move a job along the service flow (POST /api/jobs/:id/<action>), for the job list and the Bay
 * monitor. Each shows only in the stages it applies to and only to staff who may do it:
 *   waiting            -> Move into bay: staff pick a free bay when no camera saw it (BAY_JOB_CONFIRM)
 *   in a bay           -> Send to damage inspection; Not this vehicle (back to the queue) (BAY_JOB_CONFIRM)
 *   damage inspection  -> Start inspection (opens New inspection with the vehicle chosen; INSPECTION_CREATE)
 *   inspected          -> Maintenance forecast (opens the forecast wizard for this visit), or the forecast once made
 *                         (MAINTENANCE_FORECASTS)
 *   in a bay .. inspected -> Work done (BAY_JOB_CONFIRM or INSPECTION_CONFIRM); asks first if no inspection is confirmed
 *   ready              -> Customer collected (JOB_CHECK_IN)
 *   any open stage     -> Cancel, with a reason (JOB_CHECK_IN)
 */
type Job = { jobId: number; jobNo: string; stage: JobStage; registrationNo: string; vehicleId?: number; forecast?: JobForecast | null };
const IN_BAY: JobStage[] = ['in_bay', 'inspecting', 'inspected'];
const WAITING: JobStage[] = ['checked_in', 'waiting_for_bay'];

export function JobActions({ job, onDone, size = 'sm', showCancel = true }: {
  job: Job;
  onDone: () => void;
  size?: 'sm' | 'md';
  showCancel?: boolean;
}) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<'no_inspection' | 'cancel' | 'bay' | null>(null);
  const [note, setNote] = useState('');
  const [bays, setBays] = useState<{ bayId: number; name: string }[] | null>(null);
  const [bayId, setBayId] = useState('');
  const btn = size === 'sm' ? 'btn btn-sm ' : 'btn ';

  async function run(action: 'move-into-bay' | 'send-to-inspection' | 'back-to-queue' | 'work-done' | 'collected' | 'cancel', body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', `/jobs/${job.jobId}/${action}`, body);
      setAsk(null);
      setNote('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_CONFIRMED_INSPECTION') setAsk('no_inspection');
      else setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Opens the bay picker with the bays free right now. */
  async function pickBay() {
    setAsk('bay');
    setBays(null);
    setBayId('');
    setError(null);
    try {
      const free = await apiGet<{ bayId: number; name: string }[]>('/jobs/free-bays');
      setBays(free);
      if (free.length === 1) setBayId(String(free[0]!.bayId));
    } catch (err) {
      setAsk(null);
      setError(err instanceof ApiError ? err.message : 'The bays could not be loaded. Try again.');
    }
  }

  const canBay = can('BAY_JOB_CONFIRM');
  const canDone = canBay || can('INSPECTION_CONFIRM');
  const canDesk = can('JOB_CHECK_IN');

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        {WAITING.includes(job.stage) && canBay && (
          <button type="button" className={`${btn}btn-light`} disabled={busy} onClick={() => void pickBay()}
            title="Put this vehicle in a bay yourself, when the bay's camera is not running">
            <i className="bi bi-box-arrow-in-down-right me-1" aria-hidden="true" />Move into bay
          </button>
        )}
        {job.stage === 'in_bay' && canBay && (
          <button type="button" className={`${btn}btn-primary`} disabled={busy} onClick={() => void run('send-to-inspection')}>
            <i className="bi bi-clipboard-check me-1" aria-hidden="true" />Send to damage inspection
          </button>
        )}
        {job.stage === 'in_bay' && canBay && (
          <button type="button" className={`${btn}btn-light`} disabled={busy} onClick={() => void run('back-to-queue')}
            title="The camera's match was wrong: put this vehicle back in the queue (its place stays its check-in time)">
            <i className="bi bi-arrow-counterclockwise me-1" aria-hidden="true" />Not this vehicle
          </button>
        )}
        {job.stage === 'inspecting' && can('INSPECTION_CREATE') && (
          <Link className={`${btn}btn-primary`} to={`/inspections/new?job=${job.jobId}`}>
            <i className="bi bi-camera me-1" aria-hidden="true" />Start inspection
          </Link>
        )}
        {job.stage === 'inspected' && job.vehicleId && can('MAINTENANCE_FORECASTS') && (job.forecast ? (
          <Link className={`${btn}btn-light`} to={`/maintenance/forecasts/${job.forecast.forecastId}`}
            title={job.forecast.status === 'confirmed' ? 'Maintenance plan confirmed' : 'Forecast made, task not confirmed yet'}>
            <i className={`bi ${job.forecast.status === 'confirmed' ? 'bi-check2-circle text-success' : 'bi-wrench-adjustable'} me-1`} aria-hidden="true" />Forecast
          </Link>
        ) : (
          <Link className={`${btn}btn-primary`} to={`/maintenance/forecasts/new?vehicleId=${job.vehicleId}&jobId=${job.jobId}`}>
            <i className="bi bi-wrench-adjustable me-1" aria-hidden="true" />Maintenance forecast
          </Link>
        ))}
        {IN_BAY.includes(job.stage) && canDone && (
          <button type="button" className={`${btn}btn-light`} disabled={busy} onClick={() => void run('work-done')}>
            <i className="bi bi-check2-circle me-1" aria-hidden="true" />Work done
          </button>
        )}
        {job.stage === 'ready' && canDesk && (
          <button type="button" className={`${btn}btn-primary`} disabled={busy} onClick={() => void run('collected')}>
            <i className="bi bi-key me-1" aria-hidden="true" />Customer collected
          </button>
        )}
        {showCancel && canDesk && !['completed', 'cancelled'].includes(job.stage) && (
          <button type="button" className={`${btn}btn-link text-danger`} disabled={busy} onClick={() => setAsk('cancel')}>Cancel job</button>
        )}
      </div>
      {error && <div className="mt-2 text-start"><Alert>{error}</Alert></div>}

      {ask === 'no_inspection' && (
        <Modal title="No confirmed damage inspection" onClose={() => setAsk(null)} size="sm"
          footer={<>
            <button type="button" className="btn btn-light" onClick={() => setAsk(null)}>Go back</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run('work-done', { anyway: true })}>Mark work done anyway</button>
          </>}>
          <p className="mb-0">{job.registrationNo} ({job.jobNo}) has no confirmed damage inspection yet. The customer will not get a damage report for this visit.</p>
        </Modal>
      )}
      {ask === 'bay' && (
        <Modal title={`Move ${job.registrationNo} into a bay`} onClose={() => setAsk(null)} size="sm"
          footer={<>
            <button type="button" className="btn btn-light" onClick={() => setAsk(null)}>Go back</button>
            <button type="button" className="btn btn-primary" disabled={busy || !bayId}
              onClick={() => void run('move-into-bay', { bayId: Number(bayId) })}>Move into bay</button>
          </>}>
          {bays === null ? (
            <p className="mb-0 text-body-secondary">Loading the free bays…</p>
          ) : bays.length === 0 ? (
            <p className="mb-0">Every bay has a vehicle in it. Mark a vehicle's work done first, or wait for a bay to free up.</p>
          ) : (
            <>
              <SelectField label="Bay" required value={bayId} onChange={(e) => setBayId(e.target.value)}>
                <option value="">Choose a free bay</option>
                {bays.map((b) => <option key={b.bayId} value={b.bayId}>{b.name}</option>)}
              </SelectField>
              <p className="small text-body-secondary mb-0">
                Use this when no camera saw the vehicle arrive. It is recorded in the job's history as moved by staff.
              </p>
            </>
          )}
        </Modal>
      )}
      {ask === 'cancel' && (
        <Modal title={`Cancel ${job.jobNo}`} onClose={() => setAsk(null)} size="sm"
          footer={<>
            <button type="button" className="btn btn-light" onClick={() => setAsk(null)}>Keep the job</button>
            <button type="button" className="btn btn-danger" disabled={busy || note.trim().length < 3} onClick={() => void run('cancel', { note })}>Cancel job</button>
          </>}>
          <Field label="Why is it cancelled?" required maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
            hint="Kept in the job's history, e.g. &quot;Customer left before service&quot;." />
        </Modal>
      )}
    </>
  );
}
