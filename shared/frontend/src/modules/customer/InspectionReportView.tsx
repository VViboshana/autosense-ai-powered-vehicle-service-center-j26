import { useRef, useState, type CSSProperties } from 'react';
import { formatDate } from '@/lib/format';
import { VehicleSide } from '@/modules/inspections/VehicleSide';
import { DamageIcon } from './art';
import type { InspectionReport, MyVehicle } from './customer.types';
import { DAMAGE_NAMES, plural, PRIORITY_INFO, roughTime, SEVERITIES, severityName, severityOf, severityTone, VIEW_NAMES, VIEW_ORDER } from './customer.ui';
import { DamageMap } from './DamageMap';
import { ReportPhoto } from './ReportPhoto';
import { useCountUp } from '@/lib/useCountUp';

/**
 * One confirmed inspection, told in order: what was found overall (ring and counts), where on the car (map), the
 * photos with the damage outlined, and the list. The map, the photo and the list share one selected area: picking it
 * in any of them highlights it in all three (and switches to its photo).
 */
export function InspectionReportView({ vehicle, report, history, onPick }: {
  vehicle: MyVehicle['vehicle'];
  report: InspectionReport;
  history: InspectionReport[];
  onPick: (inspectionId: number) => void;
}) {
  const [imageId, setImageId] = useState(report.photos.find((p) => p.areas.length)?.imageId ?? report.photos[0]?.imageId);
  const [active, setActive] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const section = useRef<HTMLElement>(null);
  const photo = report.photos.find((p) => p.imageId === imageId) ?? report.photos[0];
  const overall = report.overallSeverity && report.overallSeverity !== 'unavailable' ? report.overallSeverity : null;

  function select(no: number) {
    const next = active === no ? null : no;
    setActive(next);
    const area = report.areas.find((a) => a.no === next);
    if (area && area.imageId !== imageId) setImageId(area.imageId);
  }
  /** Hovering only lights up areas on the photo being shown; it never switches photos. */
  const hoverIfShown = (no: number | null) => setHover(no !== null && photo?.areas.some((a) => a.no === no) ? no : null);
  const lit = hover ?? active;

  return (
    <section ref={section} className="cp-report">
      <div className="as-print-only">
        <div className="fs-5 fw-semibold">AutoSense · Vehicle inspection report</div>
        <div className="small text-body-secondary">
          {vehicle.registrationNo} · {vehicle.description}{vehicle.colour ? ` · ${vehicle.colour}` : ''} · printed {formatDate(new Date())}
        </div>
        <hr />
      </div>

      <div className={`cp-card cp-tone-${severityTone(overall)}`}>
        <div className="cp-rhead">
          <div style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
            <div className="cp-eyebrow cp-rise">Inspection report · {report.inspectionNo}</div>
            <h2 className="cp-title cp-rise" style={{ '--i': 1 } as CSSProperties}>
              {report.areas.length === 0 ? 'No damage found' : <><Count n={report.areas.length} /> damaged {report.areas.length === 1 ? 'area' : 'areas'} found</>}
            </h2>
            <div className="cp-metas cp-rise" style={{ '--i': 2 } as CSSProperties}>
              <span><i className="bi bi-calendar-check" aria-hidden="true" />Confirmed {formatDate(report.confirmedAt)}</span>
              <span><i className="bi bi-camera" aria-hidden="true" />{plural(report.photos.length, 'photo')}</span>
              <span className="cp-verified"><i className="bi bi-shield-check" aria-hidden="true" />Checked by a technician</span>
            </div>
          </div>
          <div className="cp-overall cp-rise" style={{ '--i': 3 } as CSSProperties}>
            <span className="cp-eyebrow">Overall</span>
            {report.areas.length === 0 ? (
              <span className="cp-pill cp-tone-success">No damage</span>
            ) : (
              overall && <span className={`cp-pill cp-tone-${severityTone(overall)}`}>{severityName(overall)}</span>
            )}
            <button type="button" className="btn btn-sm btn-light mt-1" onClick={() => section.current && printReport(section.current)}>
              <i className="bi bi-printer me-1" aria-hidden="true" />Print / PDF
            </button>
          </div>
        </div>
        <div className="cp-how cp-rise as-no-print" style={{ '--i': 4 } as CSSProperties} aria-label="How this report was made">
          <span className="st"><i>1</i>Photos of each side</span>
          <i className="bi bi-arrow-right text-body-secondary" aria-hidden="true" />
          <span className="st"><i>2</i>AI marked the damage</span>
          <i className="bi bi-arrow-right text-body-secondary" aria-hidden="true" />
          <span className="st ok"><i className="bi bi-check-lg" />A technician checked every mark</span>
        </div>
        {report.notes && (
          <p className="cp-note cp-rise" style={{ '--i': 5 } as CSSProperties}><b>Technician's note:</b> {report.notes}</p>
        )}
        {report.repair.priority && <WhatNeedsDoing plan={report.repair} />}
      </div>

      {report.areas.length > 0 && (
        <div className="cp-rgrid">
          <aside className="cp-rside">
            <div className="cp-card cp-rise" style={{ '--i': 3 } as CSSProperties}>
              <div className="cp-card-h"><i className="bi bi-pie-chart" aria-hidden="true" />Summary</div>
              <div className="cp-card-b">
                <Summary report={report} />
              </div>
            </div>
            <div className="cp-card cp-rise" style={{ '--i': 4 } as CSSProperties}>
              <div className="cp-card-h"><i className="bi bi-map" aria-hidden="true" />Where on the car</div>
              <div className="cp-card-b">
                <DamageMap areas={report.areas} active={lit} onSelect={select} onHover={hoverIfShown} />
              </div>
            </div>
          </aside>

          <div className="cp-rmain">
            {photo && (
              <div className="cp-card cp-rise as-no-print" style={{ '--i': 5 } as CSSProperties}>
                <div className="cp-card-h"><i className="bi bi-images" aria-hidden="true" />Photos</div>
                <div className="cp-ptabs" role="group" aria-label="Photo">
                  {report.photos.map((p) => (
                    <button key={p.imageId} type="button" className="cp-ptab" aria-pressed={p.imageId === photo.imageId} onClick={() => { setImageId(p.imageId); setActive(null); }}>
                      <img src={p.url} alt="" />
                      <span><b>{VIEW_NAMES[p.viewAngle]}</b><span>{plural(p.areas.length, 'area')}</span></span>
                    </button>
                  ))}
                </div>
                <ReportPhoto key={photo.imageId} photo={photo} alt={`${VIEW_NAMES[photo.viewAngle]} photo of the vehicle`} highlight={lit} onSelect={select} onHover={setHover} />
                <div className="cp-pfoot">
                  <span>Tap an outline, a number on the map, or an item in the list.</span>
                  <span>{plural(photo.areas.length, 'area')} on this photo</span>
                </div>
              </div>
            )}
            {/* On paper: every photo with damage, one after another */}
            <div className="as-print-only">
              {report.photos.filter((p) => p.areas.length).map((p) => (
                <div key={p.imageId} className="mb-3">
                  <div className="small fw-semibold mb-1">{VIEW_NAMES[p.viewAngle]}</div>
                  <ReportPhoto photo={p} alt={`${VIEW_NAMES[p.viewAngle]} photo`} />
                </div>
              ))}
            </div>

            <div className="cp-card cp-rise" style={{ '--i': 6 } as CSSProperties}>
              <div className="cp-card-h"><i className="bi bi-list-check" aria-hidden="true" />What was found</div>
              <div className="cp-card-b d-grid gap-3">
                <AreaList report={report} active={lit} onSelect={select} onHover={hoverIfShown} />
                <details className="cp-explain">
                  <summary>What do minor, moderate and severe mean?</summary>
                  <div className="cp-sevgrid">
                    {[...SEVERITIES].reverse().map((s) => (
                      <div key={s.key} className={`cp-tone-${s.tone}`}><b>{s.name}</b>{s.meaning}</div>
                    ))}
                  </div>
                  <p className="small text-body-secondary mt-2 mb-0">
                    Severity is a guide based on the type of damage and how much of the panel it covers. It is not a repair quote.
                  </p>
                </details>
              </div>
            </div>

            <div className="cp-card cp-rise as-no-print" style={{ '--i': 7 } as CSSProperties}>
              <div className="cp-card-h"><i className="bi bi-clock-history" aria-hidden="true" />This vehicle's inspections</div>
              <div className="cp-card-b">
                <div className="cp-hist">
                  {history.map((h) => (
                    <button key={h.inspectionId} type="button" className={`cp-hnode${h.inspectionId === report.inspectionId ? ' on' : ''}`} aria-current={h.inspectionId === report.inspectionId} onClick={() => onPick(h.inspectionId)}>
                      <span className="d" />
                      <b>{formatDate(h.confirmedAt)}</b>
                      <span>
                        {h.inspectionNo} · {plural(h.areas.length, 'area')}
                        {h.overallSeverity && severityOf(h.overallSeverity) ? ` · ${h.overallSeverity}` : ''}
                      </span>
                    </button>
                  ))}
                  <div className="cp-hnode ghost">
                    <span className="d" />
                    <b>Next visit</b>
                    <span>Its report will appear here</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <p className="small text-body-secondary mb-0">Reports are checked by a technician. Severity is a guide, not a repair quote.</p>
    </section>
  );
}

/**
 * What needs doing, in customer words: the most urgent priority with advice, then each service with how many areas and
 * a rough time (never exact hours or a price). A guide from the inspection; the service centre confirms the work.
 */
function WhatNeedsDoing({ plan }: { plan: InspectionReport['repair'] }) {
  const top = PRIORITY_INFO[plan.priority!];
  return (
    <div className={`cp-todo cp-tone-${top.tone} cp-rise`} style={{ '--i': 6 } as CSSProperties}>
      <div className="cp-todo-head">
        <span className="cp-todo-ic"><i className={`bi ${top.icon}`} aria-hidden="true" /></span>
        <div>
          <div className="cp-eyebrow">What needs doing</div>
          <b>{top.name}</b>
          <div className="small">{top.advice}</div>
        </div>
      </div>
      <ul className="cp-todo-list">
        {plan.services.map((s, i) => (
          <li key={s.code} style={{ '--i': i } as CSSProperties}>
            <span className={`cp-dot cp-tone-${PRIORITY_INFO[s.priority].tone}`} aria-hidden="true" />
            <b>{s.name}</b>
            <span className="text-body-secondary">{plural(s.areas, 'area')}</span>
            <span className="cp-todo-time">{roughTime(s.effortHours)}</span>
          </li>
        ))}
      </ul>
      <p className="cp-todo-note">
        {plan.effortHours && <>Altogether about <b>{roughTime(plan.effortHours).toLowerCase()}</b> of workshop time. </>}
        A guide from the inspection, not a quote: the service centre confirms the work and the cost with you.
      </p>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{useCountUp(n)}</span>;
}

/** A ring split by severity (it sweeps in), the count in the middle, and how many areas each side of the car has. */
function Summary({ report }: { report: InspectionReport }) {
  const counts = SEVERITIES.map((s) => ({ ...s, n: report.areas.filter((a) => a.severity === s.key).length }));
  const total = report.areas.length;
  const shown = useCountUp(total);
  const r = 50;
  const C = 2 * Math.PI * r;
  let start = 0;
  const segments = counts.filter((s) => s.n).map((s) => {
    const len = (s.n / total) * C;
    const seg = { ...s, len, start };
    start += len;
    return seg;
  });
  const sides = VIEW_ORDER.filter((v) => v !== 'other' || report.areas.some((a) => a.viewAngle === v));
  const maxOnSide = Math.max(4, ...sides.map((v) => report.areas.filter((a) => a.viewAngle === v).length));

  return (
    <>
      <div className="cp-ringwrap">
        <svg className="cp-ring" viewBox="0 0 128 128" role="img" aria-label={`${total} areas: ${counts.filter((s) => s.n).map((s) => `${s.n} ${s.key}`).join(', ')}`}>
          <defs>
            <mask id={`ring-${report.inspectionId}`}>
              <circle className="mask" cx="64" cy="64" r={r} fill="none" stroke="#fff" strokeWidth="16" strokeDasharray={C} transform="rotate(-90 64 64)" style={{ '--len': C } as CSSProperties} />
            </mask>
          </defs>
          <circle className="track" cx="64" cy="64" r={r} />
          <g mask={`url(#ring-${report.inspectionId})`}>
            {segments.map((s) => (
              <circle key={s.key} className={`seg cp-tone-${s.tone}`} cx="64" cy="64" r={r} strokeDasharray={`${Math.max(0, s.len - 3)} ${C}`} strokeDashoffset={-s.start} transform="rotate(-90 64 64)" />
            ))}
          </g>
          <text className="c-num" x="64" y="68" textAnchor="middle">{shown}</text>
          <text className="c-lbl" x="64" y="84" textAnchor="middle">{total === 1 ? 'AREA' : 'AREAS'}</text>
        </svg>
        <div className="cp-legend">
          {counts.map((s) => (
            <div key={s.key} className={`cp-tone-${s.tone}${s.n ? '' : ' none'}`}>
              <span className="sw" />{s.name}<b>{s.n}</b>
            </div>
          ))}
        </div>
      </div>
      <div className="cp-sides" aria-label="Areas on each side">
        {sides.map((v, row) => {
          const here = report.areas.filter((a) => a.viewAngle === v).sort((a, b) => (severityOf(b.severity)?.rank ?? 0) - (severityOf(a.severity)?.rank ?? 0));
          return (
            <div key={v} className="row">
              <span>{VIEW_NAMES[v]}</span>
              <span className="cp-bar">
                {here.map((a) => (
                  <i key={a.no} className={`cp-tone-${severityTone(a.severity)}`} style={{ width: `${100 / maxOnSide}%`, '--i': row } as CSSProperties} />
                ))}
              </span>
              <b>{here.length}</b>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** The areas grouped by side of the car, each with its damage icon, where it is and a 3-step severity meter. */
function AreaList({ report, active, onSelect, onHover }: {
  report: InspectionReport;
  active: number | null;
  onSelect: (no: number) => void;
  onHover: (no: number | null) => void;
}) {
  return (
    <div className="cp-flist">
      {VIEW_ORDER.filter((v) => report.areas.some((a) => a.viewAngle === v)).map((v) => {
        const here = report.areas.filter((a) => a.viewAngle === v);
        return (
          <div key={v} className="cp-fside">
            <div className="cp-fside-h">
              <VehicleSide angle={v} />
              {VIEW_NAMES[v]}
              <span className="c">{plural(here.length, 'area')}</span>
            </div>
            {here.map((a, k) => {
              const sev = severityOf(a.severity);
              return (
                <button
                  key={a.no}
                  type="button"
                  className={`cp-item cp-tone-${severityTone(a.severity)}${active === a.no ? ' on' : ''}`}
                  style={{ '--i': k } as CSSProperties}
                  aria-pressed={active === a.no}
                  onClick={() => onSelect(a.no)}
                  onPointerEnter={() => onHover(a.no)}
                  onPointerLeave={() => onHover(null)}
                >
                  <span className="cp-dmg-ic"><span className="no">{a.no}</span><DamageIcon label={a.label} /></span>
                  <span className="t">
                    <b>{DAMAGE_NAMES[a.label] ?? a.label}</b>
                    <span>{a.where}</span>
                    <span className="cp-tags">
                      <span className={`cp-tag cp-tag-prio cp-tone-${PRIORITY_INFO[a.repair.priority].tone}`} title={a.repair.why}>
                        <i className={`bi ${PRIORITY_INFO[a.repair.priority].icon}`} aria-hidden="true" />{PRIORITY_INFO[a.repair.priority].name}
                      </span>
                      {a.marks > 1 && <span className="cp-tag">{a.marks} marks joined into one</span>}
                      {a.addedByTechnician && <span className="cp-tag">Added by the technician</span>}
                    </span>
                  </span>
                  <span className="cp-sev">
                    <span className="cp-meter" aria-hidden="true">
                      {[1, 2, 3].map((n) => <i key={n} className={sev && n <= sev.rank ? 'f' : ''} />)}
                    </span>
                    <span className="lbl">{severityName(a.severity)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Prints just this report (the browser's print dialog also saves it as a PDF); the rest of the page is hidden. */
function printReport(section: HTMLElement) {
  document.body.classList.add('as-printing');
  section.classList.add('as-print-target');
  const done = () => {
    document.body.classList.remove('as-printing');
    section.classList.remove('as-print-target');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
