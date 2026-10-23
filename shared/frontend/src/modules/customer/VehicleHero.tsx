import { useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { STAGES } from '@/modules/dashboard/stages';
import { CarArt, PlateText } from './art';
import type { MyVehicles } from './customer.types';
import { JOURNEY, JOURNEY_STEPS, journeyStep, ordinal, plural, PRIORITY_INFO, severityName, severityTone } from './customer.ui';

type Vehicle = MyVehicles['vehicles'][number];

/** What the vehicle is doing now, in a few words. */
function stageText(visit: Vehicle['visit']) {
  if (!visit) return 'Not at the service centre';
  switch (visit.stage) {
    case 'checked_in': return 'Checked in';
    case 'waiting_for_bay': return 'Waiting for a free bay';
    case 'in_bay': return `Being serviced${visit.bay ? ` in ${visit.bay}` : ''}`;
    case 'inspecting': return `Damage inspection${visit.bay ? ` in ${visit.bay}` : ''}`;
    case 'inspected': return visit.planReady ? 'Maintenance plan ready' : 'Inspected · maintenance plan next';
    case 'ready': return 'Ready for pickup';
    default: return STAGES[visit.stage].label;
  }
}

/**
 * A vehicle on the home page: the customer's photo (or a drawing until they add one), with the visit on top of it:
 * the step in large type, a six-step progress bar, and frosted chips for the latest inspection and the queue.
 * The whole card opens the vehicle; the inspection chip opens its report; "Change photo" uploads a new one.
 */
export function VehicleHero({ v, big, onChangePhoto }: { v: Vehicle; big: boolean; onChangePhoto: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const step = v.visit ? journeyStep(v.visit.stage, v.visit.planReady) : 0;
  // Plan confirmed: the work is in progress, so every step up to the plan is done and pickup is next, not current
  const working = v.visit?.stage === 'inspected' && v.visit.planReady;
  const insp = v.latestInspection;

  async function change(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      await onChangePhoto(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cp-hero">
      {v.photoUrl ? (
        <img key={v.photoUrl} className="cp-hero-img" src={v.photoUrl} alt="" />
      ) : (
        <div className="cp-hero-art"><CarArt /></div>
      )}
      <div className="cp-hero-shade" aria-hidden="true" />
      <Link to={`/my/vehicles/${v.vehicleId}`} className="stretched-link" aria-label={`${v.registrationNo}, ${v.description}. ${stageText(v.visit)}. Open the vehicle.`} />

      <div className="cp-hero-top">
        <span className="cp-plate"><PlateText plate={v.registrationNo} /></span>
        <span className="cp-glass cp-glass-pill">
          {v.visit ? <><span className="cp-live" aria-hidden="true" />At the service centre</> : <><span className="cp-idle" aria-hidden="true" />Not at the centre</>}
        </span>
      </div>
      <button
        type="button"
        className="cp-glass cp-change"
        style={{ zIndex: 2 }}
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={`${v.photoUrl ? 'Change the' : 'Add a'} photo of ${v.registrationNo}`}
      >
        <i className={`bi ${busy ? 'bi-hourglass-split' : 'bi-camera'}`} aria-hidden="true" />
        {busy ? 'Uploading…' : v.photoUrl ? 'Change photo' : 'Add a photo'}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void change(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="cp-hero-bot">
        <div className="cp-hero-text">
          <div className="cp-hero-car">{v.description}</div>
          <div className="cp-hero-stage">{stageText(v.visit)}</div>
          {v.visit && big && (
            <ol className="cp-steps" aria-label={`Step ${step} of ${JOURNEY_STEPS}`}>
              {JOURNEY.map((s, i) => (
                <li key={s.label} className={i + 1 < step || (step === JOURNEY_STEPS && !working) ? 'done' : i + 1 === step && !working ? 'now' : ''} style={{ '--i': i } as CSSProperties}>
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        {big && (insp || v.visit) && (
          <div className="cp-chips" style={{ position: 'relative', zIndex: 2 }}>
            {insp && (
              <Link to={`/my/vehicles/${v.vehicleId}#report`} className="cp-glass cp-chip text-decoration-none">
                <span className={`cp-chip-ic cp-tone-${!insp.areas ? 'success' : insp.priority ? PRIORITY_INFO[insp.priority].tone : severityTone(insp.overallSeverity)}`}>
                  <i className={`bi ${insp.areas ? 'bi-exclamation-triangle' : 'bi-check-lg'}`} aria-hidden="true" />
                </span>
                <span>
                  <b>{insp.areas ? `${plural(insp.areas, 'damaged area')}` : 'No damage found'}</b>
                  <small>{insp.priority ? PRIORITY_INFO[insp.priority].name : 'Inspection report'}{insp.areas && insp.overallSeverity ? ` · ${severityName(insp.overallSeverity).toLowerCase()}` : ''}</small>
                </span>
              </Link>
            )}
            {v.visit && (v.visit.queuePosition !== null || v.visit.bay) && (
              <div className="cp-glass cp-chip">
                <span className={`cp-chip-ic cp-tone-${v.visit.queuePosition !== null ? 'warning' : 'info'}`}>
                  <i className={`bi ${v.visit.queuePosition !== null ? 'bi-hourglass-split' : 'bi-wrench-adjustable'}`} aria-hidden="true" />
                </span>
                <span>
                  {v.visit.queuePosition !== null ? (
                    <><b>{v.visit.queuePosition === 1 ? 'Next in line' : `${ordinal(v.visit.queuePosition)} in line`}</b><small>for a free bay</small></>
                  ) : (
                    <><b>{v.visit.bay}</b><small>Your service bay</small></>
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
