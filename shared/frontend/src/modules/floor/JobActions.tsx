import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Alert, Field } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ApiError, apiSend } from '@/lib/api';
import type { JobStage } from '@/modules/dashboard/dashboard.types';

/**
 * The buttons that move a job along the service flow (POST /api/jobs/:id/<action>), for the job list and the Bay
 * monitor. Each shows only in the stages it applies to and only to staff who may do it:
 *   in a bay           -> Send to damage inspection; Not this vehicle (back to the queue) (BAY_JOB_CONFIRM)
 *   damage inspection  -> Start inspection (opens New inspection with the vehicle chosen; INSPECTION_CREATE)
 *   in a bay .. inspected -> Work done (BAY_JOB_CONFIRM or INSPECTION_CONFIRM); asks first if no inspection is confirmed
 *   ready              -> Customer collected (JOB_CHECK_IN)
 *   any open stage     -> Cancel, with a reason (JOB_CHECK_IN)
 */
type Job = { jobId: number; jobNo: string; stage: JobStage; registrationNo: string };
const IN_BAY: JobStage[] = ['in_bay', 'inspecting', 'inspected'];

export function JobActions({ job, onDone, size = 'sm', showCancel = true }: {
  job: Job;
  onDone: () => void;
  size?: 'sm' | 'md';
  showCancel?: boolean;
}) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<'no_inspection' | 'cancel' | null>(null);
  const [note, setNote] = useState('');
  const btn = `btn btn-${size === 'sm' ? 'sm ' : ''}`;

  async function run(action: 'send-to-inspection' | 'back-to-queue' | 'work-done' | 'collected' | 'cancel', body: Record<string, unknown> = {}) {
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

  const canBay = can('BAY_JOB_CONFIRM');
  const canDone = canBay || can('INSPECTION_CONFIRM');
  const canDesk = can('JOB_CHECK_IN');

  return (
    <>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
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
