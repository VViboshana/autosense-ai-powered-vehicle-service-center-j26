/**
 * Number plates, reduced to what is matched: the letters and digits that identify the vehicle, without the province code
 * (the part OCR misreads most): "WP KP-0683" -> "KP0683", "CAB-4521" -> "CAB4521", "19-1234" -> "191234".
 * Must give the same result as member-1-occupancy/backend/app/plates.py plate_core(), which the service reports.
 */
const PROVINCES = new Set(['WP', 'CP', 'SP', 'NP', 'EP', 'NW', 'NC', 'UP', 'UV', 'SG']);
const MODERN = /^[A-Z]{2,3}\d{4}$/;
const OLD = /^\d{2,3}\d{4}$/;

export function plateCore(text: string | null | undefined): string | null {
  let s = (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length >= 8 && PROVINCES.has(s.slice(0, 2)) && MODERN.test(s.slice(2))) s = s.slice(2);
  return MODERN.test(s) || OLD.test(s) ? s : null;
}
