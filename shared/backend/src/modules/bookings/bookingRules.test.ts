import { describe, expect, it } from 'vitest';
import { addDays, bookableDays, bookingProblem, DEFAULT_BOOKING_RULES, minutesUntil, nowInZone, weekday } from './bookingRules.js';

const rules = DEFAULT_BOOKING_RULES; // 08:00 ... 15:00, 3 per time, 30 days, 2 hours notice, closed on Sundays
const monday9am = { date: '2026-10-19', minutes: 9 * 60 };

describe('booking rules', () => {
  it('reads the date and time in the service centre time zone', () => {
    // 20:00 UTC is 01:30 the next day in Colombo (UTC+5:30)
    expect(nowInZone('Asia/Colombo', new Date('2026-10-19T20:00:00Z'))).toEqual({ date: '2026-10-20', minutes: 90 });
  });

  it('counts days and weekdays across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(weekday('2026-10-18')).toBe(0); // a Sunday
    expect(minutesUntil(monday9am, '2026-10-20', '08:00')).toBe(23 * 60);
  });

  it('accepts an open time and explains each refusal', () => {
    expect(bookingProblem(rules, monday9am, '2026-10-20', '09:30')).toBeNull();
    expect(bookingProblem(rules, monday9am, '2026-10-20', '10:00')).toMatch(/times shown/);
    expect(bookingProblem(rules, monday9am, '2026-02-31', '09:30')).toMatch(/calendar/);
    expect(bookingProblem(rules, monday9am, '2026-10-18', '09:30')).toMatch(/passed/);
    expect(bookingProblem(rules, monday9am, '2026-10-25', '09:30')).toMatch(/closed/);
    expect(bookingProblem(rules, monday9am, '2026-11-30', '09:30')).toMatch(/30 days/);
    expect(bookingProblem(rules, monday9am, '2026-10-19', '09:30')).toMatch(/2 hours/);
    expect(bookingProblem(rules, monday9am, '2026-10-19', '11:00')).toBeNull();
  });

  it('lists each day with the places left at each time', () => {
    const days = bookableDays(rules, monday9am, new Map([['2026-10-20 08:00', 3], ['2026-10-20 09:30', 1]]));
    expect(days).toHaveLength(31);
    expect(days[0]!.slots.map((s) => s.left)).toEqual([0, 0, 3, 3, 3]); // 08:00 passed, 09:30 too soon
    expect(days[1]!.slots.slice(0, 2).map((s) => s.left)).toEqual([0, 2]);
    expect(days.find((d) => d.date === '2026-10-25')).toMatchObject({ closed: true });
  });
});
