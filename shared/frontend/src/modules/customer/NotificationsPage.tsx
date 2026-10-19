import { useEffect, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { NoticeRow } from './CustomerLayout';
import { usePortal } from './portal';

/** Customer: all notifications from the last 60 days. Opening the page marks them as seen. */
export function NotificationsPage() {
  const { notifications, markSeen } = usePortal();
  const navigate = useNavigate();
  const unread = notifications.data?.unread ?? 0;

  useEffect(() => {
    document.title = 'Notifications · AutoSense';
  }, []);

  // Seen once they've been on screen for a moment, so the "new" dots are visible first
  useEffect(() => {
    if (!unread) return;
    const t = window.setTimeout(markSeen, 2500);
    return () => window.clearTimeout(t);
  }, [unread, markSeen]);

  const items = notifications.data?.items ?? [];
  return (
    <>
      <div className="pt-head cp-rise">
        <div>
          <div className="cp-eyebrow">Notifications</div>
          <h1 className="cp-title">What's new</h1>
          <div className="text-body-secondary">Updates about your vehicles, reports and bookings from the last 60 days.</div>
        </div>
        {unread > 0 && <button type="button" className="btn btn-light" onClick={markSeen}><i className="bi bi-check2-all me-2" aria-hidden="true" />Mark all as read</button>}
      </div>
      <section className="cp-card cp-rise" style={{ '--i': 1 } as CSSProperties}>
        {notifications.error && !notifications.data ? (
          <ErrorState inline error={notifications.error} onRetry={notifications.reload} />
        ) : !notifications.data ? (
          <div className="p-4 d-grid gap-3"><Skeleton width="60%" /><Skeleton width="45%" /></div>
        ) : items.length === 0 ? (
          <EmptyState icon="bi-bell" title="No notifications yet">
            We'll let you know here when your vehicle is checked in, in a bay or ready, when a report is ready, and when a
            booking is confirmed.
          </EmptyState>
        ) : (
          <ul className="list-unstyled m-0 pt-notes-page">
            {items.map((n) => <li key={n.id}><NoticeRow n={n} onClick={() => n.link && navigate(n.link)} /></li>)}
          </ul>
        )}
      </section>
    </>
  );
}
