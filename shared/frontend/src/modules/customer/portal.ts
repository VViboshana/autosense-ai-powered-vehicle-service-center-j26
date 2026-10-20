import { useOutletContext } from 'react-router-dom';
import type { ApiState } from '@/lib/useApi';
import { SERVICES } from '@/site/business';
import type { BookingStatus, MyNotifications } from './customer.types';

/** What the portal layout shares with its pages (one notifications feed for the bell and the page). */
export type PortalContext = { notifications: ApiState<MyNotifications>; markSeen: () => void };
export const usePortal = () => useOutletContext<PortalContext>();

/** How each booking status is shown to the customer. */
export const BOOKING_STATUS: Record<BookingStatus, { label: string; tone: string; icon: string }> = {
  pending: { label: 'Waiting for confirmation', tone: 'warning', icon: 'bi-hourglass-split' },
  confirmed: { label: 'Confirmed', tone: 'success', icon: 'bi-check-circle' },
  declined: { label: 'Declined', tone: 'danger', icon: 'bi-x-circle' },
  cancelled: { label: 'Cancelled', tone: 'muted', icon: 'bi-slash-circle' },
  checked_in: { label: 'Checked in', tone: 'info', icon: 'bi-box-arrow-in-right' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A 'YYYY-MM-DD' day in parts, read as a calendar day (no time zone can move it). */
export function dayParts(date: string) {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { day: d, month: MONTHS[m - 1]!, year: y, weekday: WEEKDAYS[weekday]!, weekdayNo: weekday };
}

/** "Tue 21 Oct" */
export function shortDay(date: string) {
  const p = dayParts(date);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago", then the date. */
export function timeAgo(value: string, now = Date.now()) {
  const minutes = Math.floor((now - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(value));
}

/** The icon of a service, by its code (falls back to a wrench). */
export const serviceIcon = (code: string) => SERVICES.find((s) => s.code === code)?.icon ?? 'bi-wrench-adjustable';
