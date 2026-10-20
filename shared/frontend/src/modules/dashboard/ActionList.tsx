import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { formatDuration, minutesSince } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import type { ActionItem } from './dashboard.types';

type Meta = { title: string; icon: string; tone: string; screen: string; url: string; owner: string; detail: (a: ActionItem) => string };

const META: Record<ActionItem['key'], Meta> = {
  safety_alerts: {
    title: 'Acknowledge safety alerts', icon: 'bi-shield-exclamation', tone: 'danger', screen: 'SAFETY_ALERTS', url: '/safety/alerts', owner: 'Safety',
    detail: (a) => a.detail ?? 'Open alerts on the floor',
  },
  inspection_review: {
    title: 'Review inspections', icon: 'bi-clipboard-check', tone: 'brand', screen: 'INSPECTION_REVIEW', url: '/inspections/review', owner: 'Inspections',
    detail: (a) => (a.detail && a.at ? `Oldest: ${a.detail} · ${formatDuration(minutesSince(a.at))}` : 'Nothing waiting'),
  },
  maintenance_suggestions: {
    title: 'Accept maintenance suggestions', icon: 'bi-wrench-adjustable', tone: 'info', screen: 'MAINTENANCE_FORECASTS', url: '/maintenance/forecasts', owner: 'Maintenance',
    detail: () => 'Suggested work for vehicles today',
  },
  waiting_for_bay: {
    title: 'Vehicles waiting for a bay', icon: 'bi-hourglass', tone: 'warning', screen: 'JOBS', url: '/floor/jobs', owner: 'Service floor',
    detail: (a) => (a.at ? `Longest: ${formatDuration(minutesSince(a.at))}` : 'No one waiting'),
  },
  vehicle_requests: {
    title: 'Customer vehicle requests', icon: 'bi-person-check', tone: 'brand', screen: 'VEHICLE_CLAIMS', url: '/floor/vehicle-requests', owner: 'Service floor',
    detail: (a) => (a.at ? `Oldest: ${formatDuration(minutesSince(a.at))}` : 'None waiting'),
  },
  cameras_offline: {
    title: 'Cameras offline', icon: 'bi-camera-video-off', tone: 'muted', screen: 'BAYS_CAMERAS', url: '/setup/bays', owner: 'Cameras',
    detail: (a) => (a.detail ? `${a.detail}${a.at ? ` · ${formatDuration(minutesSince(a.at))}` : ''}` : 'All cameras online'),
  },
};

/** "Needs your action": work queues with counts. Queues of components that are not connected yet show as such. */
export function ActionList() {
  const { can } = useSession();
  const { data, error, loading, reload } = useApi<ActionItem[]>('/dashboard/actions', undefined, { refreshMs: 30_000 });

  const visible = (data ?? []).filter((a) => can(META[a.key].screen) || !a.connected);
  const live = visible.filter((a) => a.connected);
  const total = live.reduce((n, a) => n + a.count, 0);

  return (
    <Card
      className="h-100"
      icon="bi-list-check"
      title="Needs your action"
      labelledBy="needs-action"
      subtitle={data ? (total === 0 ? 'Nothing waiting' : `${total} item${total === 1 ? '' : 's'} across ${live.filter((a) => a.count > 0).length} queues`) : 'Loading…'}
    >
      {error && !data ? (
        <ErrorState inline error={error} onRetry={reload} />
      ) : loading || !data ? (
        <div className="d-grid gap-4 px-4 pb-4 pt-2" aria-busy="true">
          {['85%', '70%', '80%', '60%', '75%'].map((w) => (
            <Skeleton key={w} width={w} />
          ))}
        </div>
      ) : (
        <ul className="as-actions">
          {visible.map((a, i) => {
            const m = META[a.key];
            if (!a.connected) {
              return (
                <li key={a.key}>
                  <div className="as-action-off" title={`Available when ${m.owner} is connected`}>
                    <span className={`as-act-ic as-tone-${m.tone}`}>
                      <i className={`bi ${m.icon}`} aria-hidden="true" />
                    </span>
                    <span className="as-act-main">
                      <b>{m.title}</b>
                      <small>Connects when {m.owner} is ready</small>
                    </span>
                  </div>
                </li>
              );
            }
            return (
              <li key={a.key}>
                <Link to={m.url} className={a.count > 0 ? 'hot' : undefined} style={{ '--i': i } as CSSProperties}>
                  <span className={`as-act-ic as-tone-${m.tone}`}>
                    <i className={`bi ${m.icon}`} aria-hidden="true" />
                  </span>
                  <span className="as-act-main">
                    <b>{m.title}</b>
                    <small>{m.detail(a)}</small>
                  </span>
                  <span className={`as-count${a.count === 0 ? ' zero' : a.key === 'safety_alerts' ? ' danger' : ''}`}>{a.count}</span>
                  <i className="bi bi-chevron-right as-chev" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
