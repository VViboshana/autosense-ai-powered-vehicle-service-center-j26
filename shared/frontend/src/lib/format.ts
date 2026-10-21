/**
 * How AutoSense shows dates, times, durations and money. Use these everywhere instead of formatting by hand.
 * Times are shown in the service centre's time zone (setting app.timezone), whatever the browser's zone is.
 */
let timeZone = 'Asia/Colombo';

export function setTimeZone(tz: string) {
  timeZone = tz;
}

const part = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone, ...opts }).format(d);

/** 16/10/2026 */
export function formatDate(value: string | Date) {
  return part(new Date(value), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Thursday, 16/10/2026 */
export function formatLongDate(value: string | Date) {
  return `${part(new Date(value), { weekday: 'long' })}, ${formatDate(value)}`;
}

/** 09:54 (24-hour) */
export function formatTime(value: string | Date) {
  return part(new Date(value), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** 09:54:07 (24-hour, with seconds: for events that can be seconds apart, e.g. bay changes) */
export function formatTimeSeconds(value: string | Date) {
  return part(new Date(value), { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
}

/** Hour of the day (0-23) in the service centre's time zone. */
export function localHour(value: Date = new Date()) {
  return Number(part(value, { hour: '2-digit', hourCycle: 'h23' }));
}

/** Whole minutes from `from` until now (never negative). */
export function minutesSince(from: string | Date) {
  return Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 60_000));
}

/** 42 min · 1h 05m */
export function formatDuration(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** 28,500.00 (currency shown in the column header, e.g. "Estimate (LKR)") */
export function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

/** Initials for an avatar: "Nimal Perera" -> "NP" */
export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

const PROVINCES = new Set(['WP', 'CP', 'SP', 'NP', 'EP', 'NW', 'NC', 'UP', 'UV', 'SG']);

/**
 * Shape a number plate the Sri Lankan way while it is typed, however the user spaces it:
 * "wpkp0683" → "WP KP-0683", "cab 4521" → "CAB-4521", "191234" → "19-1234".
 * Letters: an optional province code, then the 2-3 letter series, then a dash and up to 4 digits.
 * Older all-number plates keep the last 4 digits after the dash (or the dash where the user typed one).
 */
export function formatPlate(input: string) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9 -]/g, '');
  const s = raw.replace(/[ -]/g, '');
  if (!s) return '';

  if (/^\d/.test(s)) {
    // Old numeric plates: "19-1234", "250-1234". Honour a separator the user typed, else split before the last 4.
    const typed = raw.trim().match(/^(\d{1,3})[ -]+(\d{0,4})/);
    if (typed) return `${typed[1]}-${typed[2]}`;
    const digits = s.replace(/\D/g, '').slice(0, 7);
    return digits.length > 5 ? `${digits.slice(0, -4)}-${digits.slice(-4)}` : digits;
  }

  const letters = (s.match(/^[A-Z]+/)?.[0] ?? '').slice(0, 5);
  const digits = s.slice(letters.length).replace(/\D/g, '').slice(0, 4);
  const spaced = /^\s*[A-Z]{2}[ -]+[A-Z]/.test(raw);
  const province = (letters.length >= 4 || spaced) && PROVINCES.has(letters.slice(0, 2)) ? letters.slice(0, 2) : '';
  const series = (province ? letters.slice(2) : letters).slice(0, 3);
  const head = province ? `${province} ${series}` : series;
  return digits ? `${head}-${digits}` : head;
}
