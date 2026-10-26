import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { StatusPill } from '@/components/ui/StatusPill';
import type { Handover } from './inspections.types';
import { hours } from './inspections.ui';

/**
 * Hand-over to maintenance: what the maintenance forecast receives from this inspection (inspection-handover-v1, also
 * GET /api/inspections/:id/handover and the inspection.report event). Safe to drive or not, the work in hours, the
 * forecast categories the sounds point to, the likely parts, and the diagnosis sentence ready for the forecast.
 */
export function HandoverCard({ handover: h }: { handover: Handover }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(h.diagnosis);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Card
      className="mb-3"
      icon="bi-box-arrow-right"
      title="Hand-over to maintenance"
      subtitle={h.final
        ? 'Sent to the maintenance forecast when the inspection was confirmed.'
        : 'Draft: sent to the maintenance forecast when the inspection is confirmed (updates as you review).'}
      actions={<StatusPill tone={h.final ? 'success' : 'muted'}>{h.final ? 'Sent' : 'Draft'}</StatusPill>}
    >
      <div className="as-card-body">
        <div className={`as-ho-safe ${h.safeToDrive.safe ? 'ok' : 'no'}`}>
          <i className={`bi ${h.safeToDrive.safe ? 'bi-shield-check' : 'bi-sign-stop'}`} aria-hidden="true" />
          <div>
            <b>{h.safeToDrive.safe ? 'Safe to drive' : 'Not safe to drive until fixed'}</b>
            {h.safeToDrive.safe ? (
              <span>Nothing found needs fixing before the vehicle is driven.</span>
            ) : (
              <ul>{h.safeToDrive.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
          </div>
        </div>

        <div className="as-ho-tiles">
          <div>
            <small>Workshop time</small>
            <b className="as-num">{hours(h.work.totalHours)}</b>
            <span>body {hours(h.work.bodyHours)} · mechanical {hours(h.work.mechanicalHours)}</span>
          </div>
          <div>
            <small>Forecast categories</small>
            {h.categoryHints.length ? (
              <span className="as-ho-chips">
                {h.categoryHints.map((c) => <span key={c.category} title={`Because: ${c.because.join(', ')}`}>{c.category}</span>)}
              </span>
            ) : <span>None from the sounds</span>}
          </div>
          <div>
            <small>Parts likely needed</small>
            <b className="as-num">{h.parts.reduce((s, p) => s + p.quantity, 0)}</b>
            <span>{h.parts.length} {h.parts.length === 1 ? 'kind' : 'kinds'}</span>
          </div>
        </div>

        {h.parts.length > 0 && (
          <table className="table as-table as-ho-parts">
            <thead><tr><th>Part (proposed)</th><th className="text-end">Qty</th><th>For</th></tr></thead>
            <tbody>
              {h.parts.map((p) => (
                <tr key={p.part}>
                  <td><i className={`bi ${p.kind === 'body' ? 'bi-car-front' : 'bi-gear'} me-2 text-body-secondary`} aria-hidden="true" />{p.part}</td>
                  <td className="text-end as-num">{p.quantity}</td>
                  <td className="small text-body-secondary">{[...new Set(p.for)].join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="as-ho-diag">
          <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
            <small>Diagnosis for the forecast</small>
            <button type="button" className="btn btn-sm btn-light" onClick={() => void copy()}>
              <i className={`bi ${copied ? 'bi-check2' : 'bi-clipboard'} me-1`} aria-hidden="true" />{copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p>{h.diagnosis}</p>
        </div>

        <p className="small text-body-secondary mb-0">
          {h.version} · from {h.methods.severity ?? 'rule-v0'}, {h.methods.repair}, {h.methods.mechanical} and {h.methods.parts}.
          Hours and parts are proposals until the service centre's technician confirms them; never a quote or an order.
        </p>
      </div>
    </Card>
  );
}
