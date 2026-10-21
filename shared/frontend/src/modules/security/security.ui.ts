import type { Tone } from '@/components/ui/StatusPill';
import type { AlertActionKind, AlertListItem, AlertStatus, Severity, ThreatType, ZoneType } from './security.types';

/** Severity is a state, so it uses the state colours: blue low, amber medium, red high and critical. */
export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'info' },
  medium: { label: 'Medium', tone: 'warning' },
  high: { label: 'High', tone: 'danger' },
  critical: { label: 'Critical', tone: 'danger' },
};
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const THREAT: Record<ThreatType, { label: string; icon: string }> = {
  fire: { label: 'Fire', icon: 'bi-fire' },
  smoke: { label: 'Smoke', icon: 'bi-cloud-haze2' },
  weapon: { label: 'Weapon', icon: 'bi-exclamation-octagon' },
  tampering: { label: 'Vehicle tampering', icon: 'bi-car-front' },
  unauthorised_access: { label: 'Unauthorised access', icon: 'bi-door-open' },
  loitering: { label: 'Loitering', icon: 'bi-person-walking' },
  concealed_identity: { label: 'Concealed identity', icon: 'bi-incognito' },
};

/** Status of an alert; a resolved alert shows how it ended (handled or false alarm). */
export function alertStatus(a: Pick<AlertListItem, 'status' | 'resolution'>): { label: string; tone: Tone } {
  if (a.status === 'resolved') return a.resolution === 'false_alarm' ? { label: 'False alarm', tone: 'muted' } : { label: 'Resolved', tone: 'success' };
  return STATUS[a.status];
}
const STATUS: Record<Exclude<AlertStatus, 'resolved'>, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'danger' },
  acknowledged: { label: 'Acknowledged', tone: 'brand' },
};

/** Who is told (notify_roles in the alert and the threat catalogue). */
export const ROLES: Record<string, string> = {
  security_guard: 'Security guard',
  bay_supervisor: 'Bay supervisor',
  centre_manager: 'Centre manager',
  vehicle_owner: 'Vehicle owner',
  fire_service: 'Fire service',
  police: 'Police',
  emergency_services: 'Emergency services',
  emergency_call_after_staff_confirm: 'Emergency services (after staff confirm)',
  log_only: 'Logged only',
};
export const roleLabel = (r: string) => ROLES[r] ?? r.replace(/_/g, ' ');

export const ZONE_TYPE: Record<ZoneType, { label: string; rule: string; tone: Tone }> = {
  public: { label: 'Public', rule: 'Visitors allowed', tone: 'success' },
  parking: { label: 'Parking', rule: 'Visitors allowed; time near a vehicle is watched', tone: 'info' },
  work: { label: 'Work area', rule: 'Visitors only with a worker nearby', tone: 'warning' },
  restricted: { label: 'Restricted', rule: 'Staff only', tone: 'danger' },
};

export const PERSON_ROLE = { worker: 'Worker (uniform)', visitor: 'Visitor', unknown: 'Not recognised' } as const;

/** Classes of the C4 detection model. */
export const MODEL_CLASS: Record<string, string> = {
  person: 'Person',
  vehicle: 'Vehicle',
  weapon: 'Weapon',
  fire: 'Fire',
  smoke: 'Smoke',
  tampering: 'Tampering',
  loitering: 'Loitering',
  face_covered: 'Face covered',
  worker: 'Worker',
};
export const classLabel = (c: string) => MODEL_CLASS[c] ?? c;

export const ACTION: Record<AlertActionKind, { label: string; icon: string }> = {
  raised: { label: 'Raised by the security service', icon: 'bi-broadcast' },
  escalated: { label: 'Severity raised', icon: 'bi-arrow-up-circle' },
  acknowledged: { label: 'Acknowledged', icon: 'bi-person-check' },
  emergency_called: { label: 'Emergency services called', icon: 'bi-telephone-outbound' },
  owner_informed: { label: 'Vehicle owner informed', icon: 'bi-person-lines-fill' },
  note: { label: 'Note', icon: 'bi-chat-left-text' },
  resolved: { label: 'Resolved', icon: 'bi-check2-circle' },
  false_alarm: { label: 'Marked as a false alarm', icon: 'bi-x-circle' },
  reopened: { label: 'Reopened', icon: 'bi-arrow-counterclockwise' },
};

/** 0.873 -> "87%" */
export const percent = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/** 260 -> "4 min 20 s" */
export function formatSeconds(s: number | null | undefined) {
  if (s == null) return '—';
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}

/** Status of a recorded video analysis. */
export const VIDEO_STATUS: Record<'running' | 'done' | 'failed', { label: string; tone: Tone }> = {
  running: { label: 'Analysing', tone: 'brand' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;


/** 41.5 -> "0:41" (a moment in a clip) */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
