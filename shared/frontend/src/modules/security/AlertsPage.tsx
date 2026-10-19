import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { Pagination } from '@/components/ui/Pagination';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { formatDate, formatDuration, formatTime, minutesSince } from '@/lib/format';
import type { Page } from '@/lib/page';
import { useApi, type ApiState } from '@/lib/useApi';
import { SeverityPill, ThreatCell } from './SecurityParts';
import type { AlertListItem, AlertView, SecurityCamera, SecuritySummary, Severity, ThreatType } from './security.types';
import { alertStatus, SEVERITY, SEVERITY_ORDER, THREAT } from './security.ui';
import './security.css';

const TABS: { key: AlertView; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'all', label: 'All' },
];

function Kpi({ icon, label, value, note, hot, to }: { icon: string; label: string; value: ReactNode; note: ReactNode; hot?: boolean; to?: string }) {
  const body = (
    <>
      <span className="as-kpi-label">
        <i className={`bi ${icon}`} aria-hidden="true" />
        {label}
      </span>
      <span className="as-kpi-value">{value}</span>
      <span className="as-kpi-note">{note}</span>
    </>
  );
  const className = `as-kpi${hot ? ' as-sec-hot' : ''}`;
  return to ? <Link className={className} to={to}>{body}</Link> : <div className={className}>{body}</div>;
}

function Summary({ summary, can }: { summary: ApiState<SecuritySummary>; can: (code: string) => boolean }) {
  const { data, error, loading, reload } = summary;
  if (error && !data) {
    return (
      <section className="as-card">
        <ErrorState inline error={error} onRetry={reload} title="Alert figures couldn't be loaded" />
      </section>
    );
  }
  if (loading || !data) {
    return (
      <section className="as-card as-kpis" aria-label="Alert figures" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="as-kpi" key={i}>
            <Skeleton width="55%" />
            <Skeleton width="30%" className="my-2" />
            <Skeleton width="70%" />
          </div>
        ))}
      </section>
    );
  }
  const { open } = data;
  const lowerOpen = open.medium + open.low;
  return (
    <section className="as-card as-kpis" aria-label="Alert figures">
      <Kpi icon="bi-exclamation-triangle" label="Critical, open" value={open.critical} hot={open.critical > 0}
        note={open.critical > 0 ? 'Act now: fire, weapon or tampering' : 'None'} />
      <Kpi icon="bi-shield-exclamation" label="High, open" value={open.high} hot={open.high > 0} note={open.high > 0 ? 'Needs a guard' : 'None'} />
      <Kpi icon="bi-shield" label="Medium and low, open" value={lowerOpen}
        note={lowerOpen > 0 ? `${open.medium} medium · ${open.low} low` : 'None'} />
      <Kpi icon="bi-person-check" label="Being handled" value={data.acknowledged}
        note={data.oldestOpenAt ? `Oldest open: ${formatDuration(minutesSince(data.oldestOpenAt))}` : 'Nothing waiting'} />
      <Kpi icon="bi-calendar-check" label="Raised today" value={data.today.raised}
        note={`${data.today.resolved} resolved · ${data.today.falseAlarms} false ${data.today.falseAlarms === 1 ? 'alarm' : 'alarms'}`} />
      <Kpi icon="bi-camera-video" label="Cameras online" to={can('CAMERAS') ? '/safety/cameras' : undefined}
        value={<>{data.cameras.online}<small>of {data.cameras.total}</small></>}
        note={data.cameras.online < data.cameras.total ? `${data.cameras.total - data.cameras.online} offline` : 'All online'} />
    </section>
  );
}

/**
 * Safety › Alerts (SAFETY_ALERTS): every security and safety alert the security service raised. Active alerts are
 * listed most severe first and refresh every 15 seconds; a guard opens one to acknowledge and resolve it.
 * ?camera=<id> (from the Cameras screen) shows one camera's alerts.
 */
export function AlertsPage() {
  const { can } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const cameraId = Number(params.get('camera')) || undefined;

  const [view, setView] = useState<AlertView>('active');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [threat, setThreat] = useState<ThreatType | ''>('');
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const summary = useApi<SecuritySummary>('/security/summary', undefined, { refreshMs: 15_000 });
  const list = useApi<Page<AlertListItem>>(
    '/security/alerts',
    { view, severity, threat, cameraId, search, page, pageSize },
    { refreshMs: view === 'active' ? 15_000 : undefined },
  );
  const cameras = useApi<SecurityCamera[]>(cameraId && can('CAMERAS') ? '/security/cameras' : null);
  const cameraName = cameras.data?.find((c) => c.cameraId === cameraId)?.name;

  const filtered = Boolean(severity || threat || search || cameraId);
  const reset = () => {
    setSeverity('');
    setThreat('');
    setDraft('');
    setSearch('');
    setPage(1);
    if (cameraId) setParams({});
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle={
          <>
            <span>Security and safety alerts from the premises cameras</span>
            <span aria-hidden="true">·</span>
            {summary.error && summary.data ? (
              <span className="text-warning">Couldn't refresh · showing {formatTime(new Date())} data</span>
            ) : (
              <span className="as-live">Live · updated {formatTime(new Date())}</span>
            )}
          </>
        }
        actions={
          <>
            {can('ALERT_RULES') && (
              <Link className="btn btn-light" to="/setup/alert-rules">
                <i className="bi bi-sliders me-1" aria-hidden="true" />
                Alert rules
              </Link>
            )}
            {can('CAMERAS') && (
              <Link className="btn btn-light" to="/safety/cameras">
                <i className="bi bi-camera-video me-1" aria-hidden="true" />
                Cameras
              </Link>
            )}
          </>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          <Summary summary={summary} can={can} />

          <Card>
            <div className="as-tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={view === t.key} onClick={() => { setView(t.key); setPage(1); }}>
                  {t.label}
                </button>
              ))}
            </div>
            <form
              className="as-toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(draft.trim());
                setPage(1);
              }}
            >
              <div className="as-sec-filters">
                <select className="form-select form-select-sm" aria-label="Severity" value={severity}
                  onChange={(e) => { setSeverity(e.target.value as Severity | ''); setPage(1); }}>
                  <option value="">Every severity</option>
                  {SEVERITY_ORDER.map((s) => <option key={s} value={s}>{SEVERITY[s].label}</option>)}
                </select>
                <select className="form-select form-select-sm" aria-label="Threat" value={threat}
                  onChange={(e) => { setThreat(e.target.value as ThreatType | ''); setPage(1); }}>
                  <option value="">Every threat</option>
                  {(Object.keys(THREAT) as ThreatType[]).map((t) => <option key={t} value={t}>{THREAT[t].label}</option>)}
                </select>
                <input
                  className="form-control form-control-sm"
                  style={{ width: '14rem' }}
                  type="search"
                  placeholder="Alert no. or vehicle no."
                  aria-label="Search by alert number or vehicle number"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" className="btn btn-sm btn-primary px-3">Search</button>
                {filtered && <button type="button" className="btn btn-sm btn-light" onClick={reset}>Clear</button>}
              </div>
              {cameraId && (
                <span className="as-sec-chip">
                  <i className="bi bi-camera-video" aria-hidden="true" />
                  {cameraName ?? 'One camera'}
                  <button type="button" className="btn-close" style={{ fontSize: '0.55rem' }} aria-label="Show every camera"
                    onClick={() => { setParams({}); setPage(1); }} />
                </span>
              )}
            </form>

            {list.error && !list.data ? (
              <ErrorState inline error={list.error} onRetry={list.reload} title="Alerts couldn't be loaded" />
            ) : (
              <div className="table-responsive" style={{ opacity: list.busy && !list.loading ? 0.6 : 1, transition: 'opacity .15s' }}>
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Alert</th>
                      <th>Threat</th>
                      <th>Severity</th>
                      <th>Where</th>
                      <th>Affected</th>
                      <th>Status</th>
                      <th>{view === 'active' ? 'Waiting' : 'Seen'}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list.loading || !list.data
                      ? Array.from({ length: 5 }, (_, i) => (
                          <tr key={i}>
                            {['7rem', '14rem', '4rem', '8rem', '7rem', '6rem', '4rem', '1rem'].map((w, j) => <td key={j}><Skeleton width={w} /></td>)}
                          </tr>
                        ))
                      : list.data.records.map((a) => {
                          const status = alertStatus(a);
                          const urgent = a.status === 'open' && (a.severity === 'critical' || a.severity === 'high');
                          return (
                            <tr key={a.alertId} className={urgent ? 'as-sec-row-alert' : undefined} style={{ cursor: 'pointer' }}
                              onClick={() => navigate(`/safety/alerts/${a.alertId}`)}>
                              <td className="as-veh">
                                <Link to={`/safety/alerts/${a.alertId}`} onClick={(e) => e.stopPropagation()}><b className="as-mono">{a.alertNo}</b></Link>
                                <small className="as-num">{formatDate(a.detectedAt)} {formatTime(a.detectedAt)}</small>
                              </td>
                              <td><ThreatCell threat={a.threatType} severity={a.severity} name={a.threatName} detail={a.summary} /></td>
                              <td><SeverityPill severity={a.severity} escalated={a.escalated} /></td>
                              <td className="small">
                                {a.camera ?? '—'}
                                {a.zone && <div className="text-body-secondary">{a.zone}</div>}
                              </td>
                              <td className="small">
                                {a.vehicle ? (
                                  <>
                                    <b className="as-mono">{a.vehicle.registrationNo}</b>
                                    {a.vehicle.bay && <div className="text-body-secondary">{a.vehicle.bay}</div>}
                                  </>
                                ) : a.personsAffected > 0 ? (
                                  <span>{a.personsAffected} {a.personsAffected === 1 ? 'person' : 'people'} nearby</span>
                                ) : (
                                  <span className="text-body-secondary">None</span>
                                )}
                              </td>
                              <td><StatusPill tone={status.tone}>{status.label}</StatusPill></td>
                              <td className="small as-num text-nowrap">
                                {view === 'active' ? formatDuration(minutesSince(a.detectedAt)) : formatTime(a.detectedAt)}
                              </td>
                              <td className="text-end"><i className="bi bi-chevron-right text-body-secondary" aria-hidden="true" /></td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
                {list.data && list.data.records.length === 0 && (
                  <EmptyState
                    icon={view === 'active' && !filtered ? 'bi-shield-check' : 'bi-search'}
                    title={filtered ? 'No alerts match these filters' : view === 'active' ? 'All clear' : 'No alerts yet'}
                  >
                    {!filtered && view === 'active' && 'No open alerts. New ones appear here within seconds of being raised.'}
                  </EmptyState>
                )}
              </div>
            )}
            {list.data && <Pagination page={list.data} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />}
          </Card>
        </div>
      </div>
    </>
  );
}
