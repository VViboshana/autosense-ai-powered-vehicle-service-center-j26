import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { percent } from '@/modules/inspections/inspections.ui';
import type { Calibration, Score } from './ai.types';

/**
 * Hand-made charts for the AI hub, in the app's chart style: one hue (the brand colour) for magnitude, grey for "before"
 * next to the brand colour for "after", thin marks, hover details on every mark, and a table view of each chart.
 */

/** Confusion matrix: rows = the truth (the technician), columns = the model. One hue, more = stronger; the diagonal
 * (model and technician agree) is outlined. */
export function ConfusionMatrix({ rows, cols, matrix, rowTitle, colTitle, unit, agree = (r, c) => r === c }: {
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  matrix: number[][];
  rowTitle: string;
  colTitle: string;
  unit: [string, string];
  agree?: (row: string, col: string) => boolean;
}) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="ai-cm-wrap">
      <div
        className="ai-cm"
        role="table"
        aria-label={`${rowTitle} against ${colTitle}`}
        style={{ gridTemplateColumns: `minmax(6.5rem, 9rem) repeat(${cols.length}, 3.6rem)` } as CSSProperties}
      >
        <span className="ai-cm-corner" role="columnheader">{rowTitle} ↓ · {colTitle} →</span>
        {cols.map((c) => <span key={c.key} className="ai-cm-col" role="columnheader" title={c.label}>{c.label}</span>)}
        {rows.map((r, i) => (
          <div key={r.key} className="ai-cm-row" role="row">
            <span className="ai-cm-rowh" role="rowheader">{r.label}</span>
            {cols.map((c, j) => {
              const n = matrix[i]?.[j] ?? 0;
              const share = n ? 14 + (n / max) * 76 : 0;
              return (
                <span
                  key={c.key}
                  role="cell"
                  className={`ai-cm-cell${n ? ' filled' : ''}${agree(r.key, c.key) ? ' agree' : ''}${share > 55 ? ' dark' : ''}`}
                  style={{ background: n ? `color-mix(in srgb, var(--as-primary) ${share}%, var(--as-surface))` : undefined, '--d': `${(i + j) * 40}ms` } as CSSProperties}
                  title={`${r.label} (${rowTitle.toLowerCase()}), ${c.label} (${colTitle.toLowerCase()}): ${n} ${n === 1 ? unit[0] : unit[1]}`}
                >
                  {n || '·'}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Reliability diagram: for each confidence band, how often the model was right (bar) against the confidence it gave
 * (the line: perfectly honest confidence, drawn on top). Bars below the line = over-confident, above = under-confident.
 * How many results fell in each band is the grey strip under the axis.
 */
export function Reliability({ calibration }: { calibration: Calibration }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 460, PH = 210, L = 46, R = 12, T = 10;
  const x = (v: number) => L + v * (W - L - R);
  const y = (v: number) => T + (1 - v) * PH;
  const base = y(0);
  const STRIP = 22; // results-per-band strip under the x axis
  const H = base + 28 + STRIP + 24;
  const maxCount = Math.max(1, ...calibration.bins.map((b) => b.count));
  const used = calibration.bins.filter((b) => b.count > 0);
  const shown = hover !== null ? calibration.bins[hover] : null;
  // Signed gap, weighted by band size: + = right more often than it claims (under-confident)
  const gap = calibration.count
    ? used.reduce((s, b) => s + (b.count / calibration.count) * ((b.accuracy ?? 0) - (b.meanConfidence ?? 0)), 0)
    : 0;
  const verdict = calibration.count < 20
    ? 'Too few results to judge yet.'
    : gap > 0.05 ? 'Under-confident: it is right more often than it claims.'
    : gap < -0.05 ? 'Over-confident: it claims more than it delivers.'
    : 'Well calibrated: its confidence can be taken at face value.';
  return (
    <figure className="ai-rel">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Confidence against how often right, ${calibration.count} results. ${verdict}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="ai-grid" />
            <text x={L - 8} y={y(v) + 4} className="ai-tick" textAnchor="end">{v * 100}%</text>
            <text x={x(v)} y={base + 16} className="ai-tick" textAnchor="middle">{v * 100}%</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={base} y2={base} className="ai-axis" />
        {calibration.bins.map((b, i) => {
          if (!b.count || b.accuracy === null) return null;
          const bx = x(b.from) + 1.5;
          const bw = Math.max(3, x(b.to) - x(b.from) - 3);
          return (
            <g key={i} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <rect x={bx} width={bw} y={T} height={PH + 28 + STRIP} className="ai-hit" />
              <rect x={bx} width={bw} y={y(b.accuracy)} height={Math.max(0, base - y(b.accuracy))} rx={4}
                className={`ai-bar${hover === i ? ' on' : ''}`} style={{ '--d': `${i * 70}ms` } as CSSProperties} />
              <rect x={bx} width={bw} y={base + 24 + STRIP - (b.count / maxCount) * STRIP} height={Math.max(2, (b.count / maxCount) * STRIP)} rx={2} className="ai-count" />
            </g>
          );
        })}
        {/* drawn last, so the bars never hide it */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="ai-diag" pointerEvents="none" />
        <text x={(L + W - R) / 2} y={H - 2} className="ai-axis-title" textAnchor="middle">Model's confidence</text>
        <text transform={`translate(12 ${T + PH / 2}) rotate(-90)`} className="ai-axis-title" textAnchor="middle">How often right</text>
      </svg>
      <div className="ai-rel-legend" aria-hidden="true">
        <span><i className="bar" />How often it was right</span>
        <span><i className="line" />Honest confidence</span>
        <span><i className="count" />Results in the band</span>
      </div>
      <figcaption className="ai-rel-cap" aria-live="polite">
        {shown
          ? `${percent(shown.from)}–${percent(shown.to)} confident: ${shown.count} ${shown.count === 1 ? 'result' : 'results'}, right ${percent(shown.accuracy)} of the time (it said ${percent(shown.meanConfidence)} on average).`
          : used.length
            ? <><span className="ai-rel-verdict">{verdict}</span>Calibration error (ECE) {percent(calibration.ece, 1)} over {calibration.count} results; 0% is perfectly honest. Hover a bar for its numbers.</>
            : 'No reviewed results yet.'}
      </figcaption>
    </figure>
  );
}

/** Before (grey) vs after (brand colour) for a few measures, on one 0–100% scale. */
export function BeforeAfter({ rows, before, after }: {
  rows: { label: string; before: Score; after: Score; measure: 'macroF1' | 'accuracy' }[];
  before: string;
  after: string;
}) {
  return (
    <div className="ai-ba">
      <div className="ai-legend">
        <span><i className="before" />{before}</span>
        <span><i className="after" />{after}</span>
      </div>
      {rows.map((r, i) => {
        const b = r.before?.[r.measure] ?? null;
        const a = r.after?.[r.measure] ?? null;
        const delta = a !== null && b !== null ? a - b : null;
        return (
          <div key={r.label} className="ai-ba-row">
            <span className="ai-ba-label">{r.label}<small>{r.after ? `${r.after.clips} clips` : 'no clips yet'}</small></span>
            <span className="ai-ba-bars">
              <span className="ai-ba-track" title={`${before}: ${percent(b, 1)}`}><i className="before" style={{ width: `${(b ?? 0) * 100}%`, '--d': `${i * 120}ms` } as CSSProperties} /></span>
              <span className="ai-ba-track" title={`${after}: ${percent(a, 1)}`}><i className="after" style={{ width: `${(a ?? 0) * 100}%`, '--d': `${i * 120 + 200}ms` } as CSSProperties} /></span>
            </span>
            <span className="ai-ba-val">
              {percent(a, 1)}
              {delta !== null && Math.abs(delta) >= 0.0005 && (
                <small className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}</small>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A number that counts up when it appears (stat tiles). Respects reduced motion. */
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function CountUp({ value, format = (v) => String(Math.round(v)) }: { value: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
  const last = useRef(shown);
  useEffect(() => {
    const from = last.current;
    if (from === value) return;
    if (reducedMotion()) {
      last.current = value;
      const raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      const v = from + (value - from) * (1 - (1 - k) ** 3); // ease-out
      last.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
