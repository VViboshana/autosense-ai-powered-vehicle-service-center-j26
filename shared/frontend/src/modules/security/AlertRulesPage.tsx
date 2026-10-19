import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Form';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { StatusPill } from '@/components/ui/StatusPill';
import { PageHeader } from '@/layout/PageHeader';
import { useApi } from '@/lib/useApi';
import { SeverityPill, ThreatCell } from './SecurityParts';
import type { SecurityRules } from './security.types';
import { MODEL_CLASS, roleLabel, ZONE_TYPE } from './security.ui';
import './security.css';

function Roles({ roles }: { roles: string[] }) {
  if (roles.length === 0) return <span className="small text-body-secondary">Logged only</span>;
  return (
    <div className="as-sec-roles">
      {roles.map((r) => <span key={r} className="as-sec-chip">{roleLabel(r)}</span>)}
    </div>
  );
}

function Loading() {
  return (
    <div className="as-sec-body">
      <Skeleton width="40%" />
      <div className="mt-2"><Skeleton width="90%" /></div>
      <div className="mt-2"><Skeleton width="75%" /></div>
    </div>
  );
}

/**
 * Setup › Alert rules (ALERT_RULES): the exact threats the security component detects, how severe each is and when
 * it is raised, who is notified at each severity, the camera zones, and the rule engine's thresholds.
 * Read-only here: the security service applies these rules.
 */
export function AlertRulesPage() {
  const { data, error, loading, reload } = useApi<SecurityRules>('/security/rules');

  const body = (content: (d: SecurityRules) => ReactNode) =>
    error && !data ? <ErrorState inline error={error} onRetry={reload} title="The rules couldn't be loaded" /> : loading || !data ? <Loading /> : content(data);

  return (
    <>
      <PageHeader title="Alert rules" subtitle="What the security service detects, how severe it is, and who is told" />
      <div className="app-content">
        <div className="container-fluid">
          <Alert tone="info">
            A threat becomes an alert only after it is seen for {data ? `${data.settings.persistenceSeconds} seconds` : 'a few seconds'} with at
            least {data ? `${Math.round(data.settings.minConfidence * 100)}%` : 'the minimum'} model confidence. Suspicious behaviour is
            judged from what a person does and where, together with their role (worker in uniform or visitor), never from how they look.
            Staff confirm every alert before anyone outside the centre is called.
          </Alert>

          <Card icon="bi-list-check" title="Threats" subtitle="T1 to T7, with the base severity and when it is raised">
            {body((d) => (
              <div className="table-responsive">
                <table className="table as-table">
                  <thead>
                    <tr>
                      <th>Threat</th>
                      <th>Base severity</th>
                      <th>Raised when</th>
                      <th>Who is told</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.threats.map((t) => (
                      <tr key={t.code}>
                        <td><ThreatCell threat={t.code} severity={t.baseSeverity} name={`${t.ref} · ${t.name}`} detail={t.detectedBy} /></td>
                        <td><SeverityPill severity={t.baseSeverity} /></td>
                        <td className="small" style={{ minWidth: '14rem' }}>{t.escalation}</td>
                        <td style={{ minWidth: '12rem' }}><Roles roles={t.notifyRoles} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Card>

          <div className="row g-3">
            <div className="col-xl-7">
              <Card icon="bi-bell" title="Who is notified" subtitle="By severity; every level also tells the ones above it">
                {body((d) => (
                  <div className="table-responsive">
                    <table className="table as-table">
                      <thead>
                        <tr>
                          <th>Severity</th>
                          <th>Who</th>
                          <th>How</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...d.notificationMatrix].reverse().map((n) => (
                          <tr key={n.severity}>
                            <td><SeverityPill severity={n.severity} /></td>
                            <td><Roles roles={n.notify} /></td>
                            <td className="small">{n.how}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Card>

              <Card icon="bi-signpost-split" title="Zones" subtitle="What a visitor may do in each area a camera covers">
                {body((d) => (
                  <div className="table-responsive">
                    <table className="table as-table">
                      <thead>
                        <tr>
                          <th>Zone</th>
                          <th>Type</th>
                          <th>Rule</th>
                          <th className="text-end">Cameras</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.zones.length === 0 ? (
                          <tr><td colSpan={4} className="text-body-secondary small">No zones yet.</td></tr>
                        ) : d.zones.map((z) => (
                          <tr key={z.code}>
                            <td className="as-veh"><b>{z.name}</b>{z.description && <small>{z.description}</small>}</td>
                            <td><StatusPill tone={ZONE_TYPE[z.zoneType].tone}>{ZONE_TYPE[z.zoneType].label}</StatusPill></td>
                            <td className="small">{ZONE_TYPE[z.zoneType].rule}</td>
                            <td className="text-end as-num">{z.cameras}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Card>
            </div>

            <div className="col-xl-5">
              <Card icon="bi-sliders" title="Rule thresholds" subtitle="Setting security.rules">
                {body(({ settings: s }) => (
                  <div className="as-sec-body">
                    <dl className="as-sec-facts">
                      <dt>Seen for at least</dt>
                      <dd className="as-num">{s.persistenceSeconds} s before an alert is raised</dd>
                      <dt>Model confidence</dt>
                      <dd className="as-num">at least {Math.round(s.minConfidence * 100)}%</dd>
                      <dt>Loitering</dt>
                      <dd className="as-num">a visitor near the same vehicle for {Math.round(s.loiteringSeconds / 60)} min</dd>
                      <dt>Tampering</dt>
                      <dd className="as-num">a visitor touching a door or window for {s.touchSeconds} s</dd>
                      <dt>Smoke to critical</dt>
                      <dd className="as-num">seen for more than {s.smokeCriticalSeconds} s</dd>
                      <dt>Worker nearby</dt>
                      <dd className="as-num">within {s.workerNearbyMetres} m</dd>
                      <dt>After hours</dt>
                      <dd className="as-num">{s.afterHours.from} to {s.afterHours.to}</dd>
                    </dl>
                  </div>
                ))}
              </Card>

              <Card icon="bi-cpu" title="What the model detects" subtitle="YOLO11, 9 classes; tracking time comes from DeepSORT">
                <div className="as-sec-body">
                  <div className="as-sec-chips">
                    {Object.values(MODEL_CLASS).map((c) => <span key={c} className="as-sec-chip">{c}</span>)}
                  </div>
                  <p className="small text-body-secondary mt-3 mb-0">
                    Unauthorised access, loitering time and a weapon being handed over are decided by the rules from these detections,
                    the zone and the tracking time, not by a model class of their own.
                  </p>
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
