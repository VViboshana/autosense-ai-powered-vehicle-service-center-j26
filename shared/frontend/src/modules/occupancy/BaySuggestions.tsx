import { useState } from 'react';
import { useSession } from '@/app/session';
import { useApi } from '@/lib/useApi';
import type { BaySuggestion, BaySuggestions as Data } from './occupancy.types';
import { PlateCheckIn, PlateInfo } from './PlatePopups';
import './occupancy.css';

/**
 * Bay monitor › number-plate pop-up (GET /api/occupancy/bay-suggestions). The only pop-up on the page: it appears when
 * the camera has read a parked vehicle's plate (the readings agree) and that vehicle is not linked by itself:
 * - on record but not checked in: check it in (today's booking, or as a walk-in) straight into the bay (PlateCheckIn);
 * - on record with a job elsewhere in the flow, or not on record at all: what was read, for staff to act on (PlateInfo).
 * A plate that matches a waiting vehicle needs no pop-up: the vehicle is linked by plate automatically.
 * Everything else (moving a waiting vehicle into a bay without a readable plate, sending to inspection, vehicle left)
 * is on the selected bay's card. Only ONE card shows at a time ("1 of 3", arrows); it can be minimised, and a spacer
 * at the end of the page keeps it from covering the last content.
 */
const keyOf = (s: BaySuggestion) => `${s.bayId}:${s.plateText}`;

export function PlateAssistant({ onDone }: { onDone: () => void }) {
  const { can } = useSession();
  const { data, reload } = useApi<Data>('/occupancy/bay-suggestions', undefined, { refreshMs: 5_000 });
  const [hidden, setHidden] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(true);

  const items = (data?.suggestions ?? []).filter((s) => s.plateStable && s.plateText && !s.plateMatched && !hidden.includes(keyOf(s)));
  if (items.length === 0) return null;
  const at = Math.min(index, items.length - 1);
  const s = items[at]!;
  const done = () => { reload(); onDone(); };
  const dismiss = () => setHidden((h) => [...h, keyOf(s)]);

  return (
    <>
      <div className="as-plate-space" aria-hidden="true" />
      <aside className="as-plate-pop" aria-label="Number plate read by the camera" aria-live="polite">
        <div className="as-plate-pop-head">
          <i className="bi bi-credit-card-2-front" aria-hidden="true" />
          <span>Number plate read</span>
          {items.length > 1 && (
            <span className="as-plate-pop-nav">
              <button type="button" className="btn btn-link btn-sm p-0" aria-label="Previous" disabled={at === 0} onClick={() => setIndex(at - 1)}>
                <i className="bi bi-chevron-left" aria-hidden="true" />
              </button>
              <span className="as-num">{at + 1} of {items.length}</span>
              <button type="button" className="btn btn-link btn-sm p-0" aria-label="Next" disabled={at === items.length - 1} onClick={() => setIndex(at + 1)}>
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </span>
          )}
          <button type="button" className="btn btn-link btn-sm p-0 ms-auto" aria-expanded={open} aria-label={open ? 'Minimise' : 'Show'} onClick={() => setOpen((o) => !o)}>
            <i className={`bi ${open ? 'bi-dash-lg' : 'bi-chevron-up'}`} aria-hidden="true" />
          </button>
        </div>
        {open && (
          s.plateVehicle && !s.plateOpenJob
            ? <PlateCheckIn key={keyOf(s)} s={s} canCheckIn={can('JOB_CHECK_IN') && can('BAY_JOB_CONFIRM')} onHide={dismiss} onDone={done} />
            : <PlateInfo key={keyOf(s)} s={s} onHide={dismiss} />
        )}
      </aside>
    </>
  );
}
