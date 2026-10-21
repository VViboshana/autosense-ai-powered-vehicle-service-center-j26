import { useEffect, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert, Field } from '@/components/ui/Form';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { ApiError, apiSend, fieldErrors } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import type { OccupancyRules, OccupancyServiceInfo } from './occupancy.types';
import './occupancy.css';

/**
 * Setup › Occupancy settings (screen OCCUPANCY_SETTINGS, component 1: bay occupancy).
 * Edits the occupancy.rules setting: when a bay counts as occupied, free or uncertain. The occupancy service applies
 * the rules to each video job when it starts, so a change affects jobs started after saving.
 */
type Key = Exclude<keyof OccupancyRules, 'autoConfirm' | 'plateLink'>;
type Form = Record<Key, string>;

/** What the service uses when a value is left empty (member-1-occupancy/backend/app/state_machine.py, Rules). */
const SERVICE_DEFAULTS = { toleranceSeconds: 1, minSupport: 0.8, staleAfterSeconds: 10 };
/** The shipped setting (database/reference/030_settings.sql). */
const SHIPPED: OccupancyRules = { overlapThreshold: 0.4, confirmOccupiedSeconds: 3, confirmFreeSeconds: 5, sampleFps: 2 };
const OPTIONAL: Key[] = ['releaseThreshold', 'toleranceSeconds', 'minSupport', 'staleAfterSeconds'];

const toForm = (r: OccupancyRules): Form => ({
  overlapThreshold: String(r.overlapThreshold),
  releaseThreshold: r.releaseThreshold === undefined ? '' : String(r.releaseThreshold),
  confirmOccupiedSeconds: String(r.confirmOccupiedSeconds),
  confirmFreeSeconds: String(r.confirmFreeSeconds),
  toleranceSeconds: r.toleranceSeconds === undefined ? '' : String(r.toleranceSeconds),
  minSupport: r.minSupport === undefined ? '' : String(r.minSupport),
  staleAfterSeconds: r.staleAfterSeconds === undefined ? '' : String(r.staleAfterSeconds),
  sampleFps: String(r.sampleFps),
});

/** The body to save, or field messages for values that are not numbers. Empty optional values are left out. */
function toRules(f: Form): { rules?: OccupancyRules; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(f) as Key[]) {
    const text = f[key].trim();
    if (text === '') {
      if (!OPTIONAL.includes(key)) errors[key] = 'Enter a number.';
      continue;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) errors[key] = 'Enter a number.';
    else out[key] = n;
  }
  return Object.keys(errors).length ? { errors } : { rules: out as unknown as OccupancyRules, errors };
}

/** The values in effect, filling empty optional ones the way the service does. */
function effective(f: Form) {
  const num = (s: string, fallback: number) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : fallback);
  const overlap = num(f.overlapThreshold, SHIPPED.overlapThreshold);
  return {
    overlap,
    release: num(f.releaseThreshold, Math.min(0.3, overlap)),
    occupied: num(f.confirmOccupiedSeconds, SHIPPED.confirmOccupiedSeconds),
    free: num(f.confirmFreeSeconds, SHIPPED.confirmFreeSeconds),
    stale: num(f.staleAfterSeconds, SERVICE_DEFAULTS.staleAfterSeconds),
  };
}

const pct = (share: number) => `${Math.round(share * 100)}%`;
const secs = (s: number) => `${s} ${s === 1 ? 'second' : 'seconds'}`;

export function OccupancySettingsPage() {
  return (
    <>
      <PageHeader title="Occupancy settings" subtitle="When a service bay counts as occupied, free or uncertain" />
      <div className="app-content"><div className="container-fluid">
        <div className="row g-3">
          <div className="col-xl-8"><RulesCard /></div>
          <div className="col-xl-4"><ServiceCard /></div>
        </div>
      </div></div>
    </>
  );
}

function RulesCard() {
  const { data, error, loading, reload } = useApi<OccupancyRules>('/occupancy/rules');
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [plateLink, setPlateLink] = useState(true);

  useEffect(() => {
    if (data) { setForm(toForm(data)); setAutoConfirm(!!data.autoConfirm); setPlateLink(data.plateLink !== false); }
  }, [data]);

  const set = (key: Key) => (e: { target: { value: string } }) => {
    setForm((f) => (f ? { ...f, [key]: e.target.value } : f));
    setErrors((x) => ({ ...x, [key]: '' }));
    setMessage(null);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { rules, errors: local } = toRules(form);
    setErrors(local);
    setMessage(null);
    if (!rules) return;
    setSaving(true);
    try {
      const saved = await apiSend<OccupancyRules>('PUT', '/occupancy/rules', { ...rules, autoConfirm, plateLink });
      setForm(toForm(saved));
      setAutoConfirm(!!saved.autoConfirm);
      setPlateLink(saved.plateLink !== false);
      setMessage({ tone: 'success', text: 'Saved. Video jobs started from now on use these rules.' });
    } catch (err) {
      setErrors(fieldErrors(err));
      setMessage({ tone: 'danger', text: err instanceof ApiError ? err.message : 'The rules could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  if (error && !data) return <Card icon="bi-sliders" title="Decision rules"><ErrorState inline error={error} onRetry={reload} title="The rules couldn't be loaded" /></Card>;
  if (loading || !form) return <Card icon="bi-sliders" title="Decision rules"><div className="as-card-body"><Skeleton width="70%" /><div className="mt-2"><Skeleton width="90%" /></div><div className="mt-2"><Skeleton width="50%" /></div></div></Card>;

  const e = effective(form);
  const field = (key: Key, label: string, hint: string, opts: { step: string; min: number; max: number; placeholder?: string }) => (
    <Field
      className="col-md-6"
      label={label}
      type="number"
      inputMode="decimal"
      step={opts.step}
      min={opts.min}
      max={opts.max}
      required={!OPTIONAL.includes(key)}
      placeholder={opts.placeholder}
      value={form[key]}
      onChange={set(key)}
      error={errors[key] || undefined}
      hint={hint}
    />
  );

  return (
    <Card
      icon="bi-sliders"
      title="Decision rules"
      subtitle="The occupancy service applies these to every video job when it starts"
    >
      <form className="as-card-body" onSubmit={(ev) => void save(ev)} noValidate>
        <p className="as-occ-summary small" aria-live="polite">
          A bay becomes <strong>occupied</strong> once a vehicle covers at least {pct(e.overlap)} of it
          for {secs(e.occupied)}, and <strong>free</strong> once coverage stays below {pct(e.release)} for {secs(e.free)}.
          With no usable picture for {secs(e.stale)}, it shows as <strong>uncertain</strong>.
        </p>

        <h3 className="as-occ-group">Vehicle in the bay</h3>
        <div className="row">
          {field('overlapThreshold', 'Occupied from (share covered)', `Share of the bay outline a vehicle must cover, 0.05 to 0.95. Shipped value: ${SHIPPED.overlapThreshold}.`, { step: '0.05', min: 0.05, max: 0.95 })}
          {field('releaseThreshold', 'Free below (share covered)', 'Lower than the value above so a bay does not flicker. Empty: 0.3 (or the value above, if lower).', { step: '0.05', min: 0, max: 0.95, placeholder: String(Math.min(0.3, e.overlap)) })}
        </div>

        <h3 className="as-occ-group">Confirmation</h3>
        <div className="row">
          {field('confirmOccupiedSeconds', 'Confirm occupied after (seconds)', 'A vehicle passing through quicker than this is ignored.', { step: '0.5', min: 0.5, max: 120 })}
          {field('confirmFreeSeconds', 'Confirm free after (seconds)', 'A bay is only released after it has looked empty this long.', { step: '0.5', min: 0.5, max: 120 })}
          {field('minSupport', 'Agreement needed (share of samples)', `Share of the frames in the confirmation time that must agree, above 0.5. Empty: ${SERVICE_DEFAULTS.minSupport}.`, { step: '0.05', min: 0.55, max: 1, placeholder: String(SERVICE_DEFAULTS.minSupport) })}
          {field('toleranceSeconds', 'Ignore blips up to (seconds)', `A brief miss (someone walking past) shorter than this does not restart the count. Empty: ${SERVICE_DEFAULTS.toleranceSeconds}.`, { step: '0.5', min: 0, max: 30, placeholder: String(SERVICE_DEFAULTS.toleranceSeconds) })}
        </div>

        <h3 className="as-occ-group">Camera</h3>
        <div className="row">
          {field('sampleFps', 'Frames analysed per second', 'More frames react sooner but need more computing time. 2 is enough for bays.', { step: '0.5', min: 0.5, max: 15 })}
          {field('staleAfterSeconds', 'Uncertain after no picture for (seconds)', `Empty: ${SERVICE_DEFAULTS.staleAfterSeconds}.`, { step: '1', min: 1, max: 600, placeholder: String(SERVICE_DEFAULTS.staleAfterSeconds) })}
        </div>

        <h3 className="as-occ-group">Moving vehicles into bays</h3>
        <div className="form-check form-switch mb-1">
          <input className="form-check-input" type="checkbox" role="switch" id="plate-link" checked={plateLink}
            onChange={(e) => { setPlateLink(e.target.checked); setMessage(null); }} />
          <label className="form-check-label" htmlFor="plate-link">Link vehicles by number plate</label>
        </div>
        <p className="small text-body-secondary mb-3">
          When the camera reads the parked vehicle's number plate (several readings that agree) and exactly one waiting
          vehicle has that plate, it is moved into the bay straight away ("Linked by number plate" in its history). A plate
          that matches nobody waiting is shown to staff, never replaced by a guess. Only the plate text is stored.
        </p>
        <div className="form-check form-switch mb-1">
          <input className="form-check-input" type="checkbox" role="switch" id="auto-confirm" checked={autoConfirm}
            onChange={(e) => { setAutoConfirm(e.target.checked); setMessage(null); }} />
          <label className="form-check-label" htmlFor="auto-confirm">Auto-confirm when there is no doubt</label>
        </div>
        <p className="small text-body-secondary mb-3">
          Off: the Bay monitor suggests the waiting vehicle and staff confirm it. On: when one bay fills and exactly one
          vehicle is waiting, it is moved into that bay straight away (marked "auto-confirmed" in its history; "Not this
          vehicle" puts it back in the queue). Two cars arriving, or several waiting, are always left for staff to confirm.
          Used only when no plate could be read, so the camera cannot check that the car is really that vehicle.
        </p>

        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <div className="d-flex gap-2 flex-wrap">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save rules'}
          </button>
          <button type="button" className="btn btn-light" disabled={saving} onClick={() => { setForm(toForm(SHIPPED)); setAutoConfirm(false); setErrors({}); setMessage(null); }}>
            Restore defaults
          </button>
          <span className="small text-body-secondary align-self-center">Restoring fills in the shipped values; nothing changes until you save.</span>
        </div>
      </form>
    </Card>
  );
}

function ServiceCard() {
  const { data, error, loading, reload } = useApi<OccupancyServiceInfo>('/occupancy/service');
  return (
    <Card icon="bi-cpu" title="Occupancy service" subtitle="The detection model the service is running now">
      {error && !data ? <ErrorState inline error={error} onRetry={reload} title="The occupancy service isn't answering" />
        : loading || !data ? <div className="as-card-body"><Skeleton width="70%" /><div className="mt-2"><Skeleton width="50%" /></div></div>
        : (
          <dl className="as-card-body as-occ-facts small">
            <dt>Model</dt>
            <dd>
              <span className="as-mono">{data.version}</span>
              <div className="mt-1">
                {data.placeholder
                  ? <StatusPill tone="warning">Not fine-tuned (COCO placeholder)</StatusPill>
                  : <StatusPill tone="success">Fine-tuned on PKLot</StatusPill>}
              </div>
            </dd>
            {data.imgsz && <><dt>Image size</dt><dd>{data.imgsz} px</dd></>}
            <dt>Outside the bays</dt>
            <dd>
              {!data.roiMask ? 'Not reported by this service version'
                : data.roiMask.default ? `Greyed out before detection (margin ${data.roiMask.marginPx} px per 1280 px of width)`
                : 'Not greyed out: the whole frame is analysed'}
              {data.roiMask && <div className="text-body-secondary">Set on the service (OCC_ROI_MASK={data.roiMask.setting}).</div>}
            </dd>
            <dt>Number plates</dt>
            <dd>
              {!data.plates ? 'Not reported by this service version'
                : data.plates.enabled ? 'Read on parked vehicles (OCR, text only)'
                : 'Not read (OCR not installed or switched off)'}
            </dd>
          </dl>
        )}
    </Card>
  );
}
