import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { Skeleton } from '@/components/ui/States';
import { useApi } from '@/lib/useApi';
import { DamagePerformance } from '@/modules/inspections/DamagePerformancePage';
import { DAMAGE_LABELS } from '@/modules/inspections/inspections.ui';
import type { DamageLabel } from '@/modules/inspections/inspections.types';
import { ConfusionMatrix, CountUp, Reliability } from './AiCharts';
import type { DamageInsights, Overview } from './ai.types';

const name = (k: string) => (k === 'not_damage' ? 'Not damage' : k === 'missed' ? 'Missed' : DAMAGE_LABELS[k as DamageLabel] ?? k);

/**
 * Damage model: what technicians taught it (learning data + the Kaggle training pack), the confusion and calibration
 * from real use, then the established figures (test set vs real use, per damage type, severity rule check).
 */
export function AiDamageTab({ overview }: { overview: Overview }) {
  const { data } = useApi<DamageInsights>('/ai/damage/insights');
  const l = overview.learning.damage;
  return (
    <div className="d-grid gap-3">
      <Card icon="bi-database-add" title="Learning data from your inspections" subtitle="Every correction is a labelled example the damage model can learn from on Kaggle (it needs a GPU: about 3–5 hours continuing from best.pt).">
        <div className="as-card-body">
          <div className="ai-lessons">
            <Lesson icon="bi-pencil" n={l.corrected} title="Corrected regions" note="right place, wrong type or severity" />
            <Lesson icon="bi-bounding-box-circles" n={l.missed} title="Missed damage" note="drawn by technicians" />
            <Lesson icon="bi-x-octagon" n={l.falseAlarms} title="False alarms" note="e.g. reflections on glass, good tyres" />
            <Lesson icon="bi-images" n={l.photos} title="Reviewed photos" note="in confirmed inspections" />
          </div>
          <TrainingPack disabled={l.photos === 0} />
        </div>
      </Card>

      <div className="ai-grid-2">
        <Card icon="bi-grid-3x3-gap" title="What the AI found vs what the technician decided" subtitle="Rows: the technician's final answer. 'Not damage' = a false alarm; 'Missed' = damage the AI did not mark.">
          <div className="as-card-body">
            {!data ? <Skeleton width="100%" /> : data.matrix.flat().some(Boolean) ? (
              <ConfusionMatrix
                rows={data.truths.map((k) => ({ key: k, label: name(k) }))}
                cols={data.predicted.map((k) => ({ key: k, label: name(k) }))}
                matrix={data.matrix}
                rowTitle="Technician"
                colTitle="AI said"
                unit={['region', 'regions']}
              />
            ) : <p className="small text-body-secondary mb-0">Appears once inspections are confirmed.</p>}
          </div>
        </Card>
        <Card icon="bi-bullseye" title="Is its confidence honest?" subtitle="For the damage regions it marked: how often they were right (kept with the same type), by confidence. Bars above the line: under-confident.">
          <div className="as-card-body">{data ? <Reliability calibration={data.calibration} /> : <Skeleton width="100%" />}</div>
        </Card>
      </div>

      <DamagePerformance />
    </div>
  );
}

function Lesson({ icon, n, title, note }: { icon: string; n: number; title: string; note: string }) {
  return (
    <div className="ai-lesson">
      <i className={`bi ${icon}`} aria-hidden="true" />
      <b><CountUp value={n} /></b>
      <span>{title}<small>{note}</small></span>
    </div>
  );
}

/** Downloads the training pack (zip). A fetch, so an error comes back as a message instead of a broken download. */
function TrainingPack({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/damage/training-pack');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'The training pack could not be made.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'autosense-damage-training-pack.zip';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The training pack could not be made.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-pack">
      <div>
        <b><i className="bi bi-box-seam me-1" aria-hidden="true" />Kaggle training pack</b>
        <p className="small text-body-secondary mb-0">
          Photos with the technicians' final regions as YOLO labels (same classes as CarDD), false-alarm photos as
          "nothing here" examples, data.yaml and a manifest. Add it to the CarDD training set and continue from best.pt.
        </p>
      </div>
      <button type="button" className="btn btn-primary" disabled={busy || disabled} onClick={() => void download()}>
        <i className="bi bi-download me-1" aria-hidden="true" />{busy ? 'Packing…' : 'Download training pack'}
      </button>
      {error && <div className="w-100"><Alert>{error}</Alert></div>}
    </div>
  );
}
