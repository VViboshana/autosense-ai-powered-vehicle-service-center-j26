import type { Db } from '../../db/pool.js';
import { getSetting } from '../../lib/settings.js';

/** Which days and times customers can book (setting bookings.rules). Dates are 'YYYY-MM-DD', times 'HH:MM'. */
export type BookingRules = {
  slots: string[];
  /** Vehicles each time can take (pending and confirmed bookings count). */
  perSlot: number;
  /** The furthest day ahead that can be booked. */
  daysAhead: number;
  /** The least notice, in hours, before a booked time. */
  minHoursAhead: number;
  /** Days the centre is closed: 0 = Sunday ... 6 = Saturday. */
  closedWeekdays: number[];
};

export const DEFAULT_BOOKING_RULES: BookingRules = {
  slots: ['08:00', '09:30', '11:00', '13:30', '15:00'],
  perSlot: 3,
  daysAhead: 30,
  minHoursAhead: 2,
  closedWeekdays: [0],
};

export const getBookingRules = (db: Db) => getSetting(db, 'bookings.rules', DEFAULT_BOOKING_RULES);

/** The service centre's time zone (setting app.timezone). */
export async function centreTimeZone(db: Db): Promise<string> {
  const { rows } = await db.query<{ value: unknown }>("SELECT value FROM app.settings WHERE setting_key = 'app.timezone'");
  return typeof rows[0]?.value === 'string' ? rows[0].value : 'Asia/Colombo';
}

/** The date and minutes past midnight at `at`, in the given time zone. */
export function nowInZone(timeZone: string, at = new Date()): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const DAY_MS = 86_400_000;
const toUtc = (date: string) => Date.parse(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export const weekday = (date: string) => new Date(toUtc(date)).getUTCDay();
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Minutes from now until the time on that date (negative when it has passed). */
export function minutesUntil(now: { date: string; minutes: number }, date: string, time: string) {
  return ((toUtc(date) - toUtc(now.date)) / DAY_MS) * 1440 + minutesOf(time) - now.minutes;
}

/** Why this date and time can't be booked (ignoring how full it is), or null when it can. */
export function bookingProblem(rules: BookingRules, now: { date: string; minutes: number }, date: string, time: string): string | null {
  if (!rules.slots.includes(time)) return 'Choose one of the times shown.';
  if (Number.isNaN(toUtc(date)) || addDays(date, 0) !== date) return 'Choose a day from the calendar.';
  if (date < now.date) return 'That day has passed.';
  if (date > addDays(now.date, rules.daysAhead)) return `Bookings open ${rules.daysAhead} days ahead. Choose an earlier day.`;
  if (rules.closedWeekdays.includes(weekday(date))) return 'The service centre is closed that day.';
  if (minutesUntil(now, date, time) < rules.minHoursAhead * 60) {
    return `Book at least ${rules.minHoursAhead} hours ahead. For today, call the service centre.`;
  }
  return null;
}

/** The days customers can choose from today, each with its times and whether each time is still open. */
export function bookableDays(rules: BookingRules, now: { date: string; minutes: number }, taken: Map<string, number>) {
  const days = [];
  for (let i = 0; i <= rules.daysAhead; i++) {
    const date = addDays(now.date, i);
    const closed = rules.closedWeekdays.includes(weekday(date));
    const slots = rules.slots.map((time) => {
      const booked = taken.get(`${date} ${time}`) ?? 0;
      const tooSoon = minutesUntil(now, date, time) < rules.minHoursAhead * 60;
      return { time, left: closed || tooSoon ? 0 : Math.max(0, rules.perSlot - booked) };
    });
    days.push({ date, closed, slots });
  }
  return days;
}
