import type { DamageLabel, Severity } from './inspections.types';
import { DAMAGE_LABELS, SEVERITY, percent } from './inspections.ui';

/**
 * Charts for the damage model performance page. Small multiples in one hue (the brand colour): the test-set score
 * and the real-use precision and recall are different measures, so each has its own panel on the same 0-100% scale
 * rather than sharing an axis, and no colour has to tell series apart. The table on the page is the full data.
 */
export type ClassFigures = {
  label: DamageLabel;
  test: number | null;
  precision: number | null;
  recall: number | null;
  precisionNote: string;
  recallNote: string;
  /** How many regions each real-use figure rests on: 100% from 1 region is not 100% from 50. */
  precisionN: number;
  recallN: number;
};

const PANELS = [
  { key: 'test', title: 'Test set', sub: 'Mask mAP50-95 on CarDD' },
  { key: 'precision', title: 'Real use: precision', sub: 'Findings kept with the right type' },
  { key: 'recall', title: 'Real use: recall (est.)', sub: 'Damage the model found' },
] as const;

export function ClassSmallMultiples({ rows, total, testNote }: { rows: ClassFigures[]; total: ClassFigures; testNote: string }) {
  const cell = (r: ClassFigures, key: (typeof PANELS)[number]['key'], strong = false) => {
    const v = r[key];
    const note = key === 'test' ? testNote : key === 'precision' ? r.precisionNote : r.recallNote;
    const n = key === 'precision' ? r.precisionN : key === 'recall' ? r.recallN : null;
    return (
      <div className="as-sm-cell" title={`${r === total ? 'All damage types' : DAMAGE_LABELS[r.label]} · ${PANELS.find((p) => p.key === key)!.title}: ${percent(v)}${note ? ` (${note})` : ''}`}>
        {v === null ? (
          <span className="as-sm-none">no data yet</span>
        ) : (
          <>
            <span className="as-sm-track"><i className={strong ? 'strong' : ''} style={{ width: `${Math.max(1.5, v * 100)}%` }} /></span>
            <span className="as-sm-value as-num">{percent(v)}</span>
            {/* Always present (empty for the test set) so the bars in every panel line up with the axis */}
            <span className="as-sm-n as-num">{n !== null && `n=${n}`}</span>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="as-sm" role="table" aria-label="Test-set score and real-use precision and recall by damage type">
      <div className="as-sm-row as-sm-head" role="row">
        <span role="columnheader" />
        {PANELS.map((p) => (
          <span key={p.key} role="columnheader">
            <b>{p.title}</b>
            <small>{p.sub}</small>
          </span>
        ))}
      </div>
      <div className="as-sm-row as-sm-total" role="row">
        <span role="rowheader">All types</span>
        {PANELS.map((p) => <span key={p.key} role="cell">{cell(total, p.key, true)}</span>)}
      </div>
      {rows.map((r) => (
        <div key={r.label} className="as-sm-row" role="row">
          <span role="rowheader">{DAMAGE_LABELS[r.label]}</span>
          {PANELS.map((p) => <span key={p.key} role="cell">{cell(r, p.key)}</span>)}
        </div>
      ))}
      <div className="as-sm-row as-sm-axis" aria-hidden="true">
        <span />
        {PANELS.map((p) => <span key={p.key}><i>0%</i><i>50%</i><i>100%</i></span>)}
      </div>
    </div>
  );
}

const GRADES: Severity[] = ['minor', 'moderate', 'severe'];

/** Rule grade (rows) against the technician's final grade (columns): darker = more regions; the diagonal is agreement. */
export function SeverityHeatmap({ matrix }: { matrix: Record<Severity, Record<Severity, number>> }) {
  const max = Math.max(1, ...GRADES.flatMap((a) => GRADES.map((b) => matrix[a][b])));
  return (
    <div className="as-heat" role="table" aria-label="Severity: the rule's grade against the technician's final grade">
      <div className="as-heat-row" role="row">
        <span className="as-heat-corner" role="columnheader">Rule said ↓ · technician's final →</span>
        {GRADES.map((g) => <span key={g} className="as-heat-col" role="columnheader">{SEVERITY[g].label}</span>)}
      </div>
      {GRADES.map((rule) => (
        <div key={rule} className="as-heat-row" role="row">
          <span className="as-heat-rowh" role="rowheader">{SEVERITY[rule].label}</span>
          {GRADES.map((final) => {
            const n = matrix[rule][final];
            // One hue, more = darker; an empty cell stays the plain surface
            const share = n ? 12 + (n / max) * 78 : 0;
            return (
              <span
                key={final}
                role="cell"
                className={`as-heat-cell${rule === final ? ' agree' : ''}${share > 55 ? ' dark' : ''}`}
                style={{ background: n ? `color-mix(in srgb, var(--as-primary) ${share}%, var(--as-surface))` : undefined }}
                title={`Rule ${SEVERITY[rule].label.toLowerCase()}, technician ${SEVERITY[final].label.toLowerCase()}: ${n} ${n === 1 ? 'region' : 'regions'}`}
              >
                {n}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
