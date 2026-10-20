import type { CSSProperties } from 'react';
import { formatTime } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { ordinal } from './customer.ui';

/**
 * Customer home › "Service centre now" (GET /api/my/service-centre): the service bays, occupied or free, as the
 * camera sees them now, and where the customer's own vehicle is. Bay states come from the camera; "your vehicle"
 * comes only from the customer's confirmed job (the camera cannot tell whose car it sees). No pictures and nothing
 * about other customers. Hidden when the customer may not see vehicle status or no bays are set up.
 */
type Centre = {
  live: boolean;
  bays: { bayId: number; name: string; state: 'occupied' | 'free' | 'updating' }[];
  mine: { registrationNo: string; stage: string; bayId: number | null; bayName: string | null; queuePosition: number | null }[];
  at: string;
};

export function ServiceCentreNow({ style }: { style?: CSSProperties }) {
  const { data, error } = useApi<Centre>('/my/service-centre', undefined, { refreshMs: 10_000 });
  if (error || !data || data.bays.length === 0) return null;

  const free = data.bays.filter((b) => b.state === 'free').length;
  const mineIn = new Map(data.mine.filter((m) => m.bayId !== null).map((m) => [m.bayId!, m.registrationNo]));

  return (
    <section className="cp-card cp-rise" style={style} aria-labelledby="centre-now">
      <div className="cp-card-h justify-content-between">
        <span id="centre-now"><i className="bi bi-p-square me-1" aria-hidden="true" />Service centre now</span>
        <span className="small fw-normal text-body-secondary">
          {data.live ? <span className="as-live">Live · {formatTime(data.at)}</span> : 'Bay status not available right now'}
        </span>
      </div>
      <div className="cp-card-b">
        {data.live && (
          <p className="small mb-2">
            {free === 0 ? 'Every bay is busy at the moment.' : `${free} of ${data.bays.length} bays free.`}
          </p>
        )}
        <ul className="cp-bays" aria-label="Service bays">
          {data.bays.map((b) => {
            const mine = mineIn.get(b.bayId);
            return (
              <li key={b.bayId} className={`cp-bay cp-bay-${b.state}${mine ? ' mine' : ''}`}>
                <span className="cp-bay-dot" aria-hidden="true" />
                <span className="cp-bay-name">{b.name}</span>
                <span className="cp-bay-state">{mine ? 'Your vehicle' : b.state === 'occupied' ? 'Busy' : b.state === 'free' ? 'Free' : 'Updating'}</span>
              </li>
            );
          })}
        </ul>
        {data.mine.length > 0 && (
          <ul className="cp-bay-mine">
            {data.mine.map((m) => (
              <li key={m.registrationNo}>
                <b>{m.registrationNo}</b>{' '}
                {m.bayName ? `is in ${m.bayName}.`
                  : m.queuePosition !== null ? (m.queuePosition === 1 ? 'is next for a bay.' : `is ${ordinal(m.queuePosition)} in line for a bay.`)
                  : m.stage === 'ready' ? 'is ready for pickup.'
                  : 'is at the service centre.'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
