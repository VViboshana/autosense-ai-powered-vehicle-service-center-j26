/** Fixed value lists of the security component; the same lists as the CHECK constraints in 0007_security.sql. */
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const THREAT_TYPES = ['fire', 'smoke', 'weapon', 'tampering', 'unauthorised_access', 'loitering', 'concealed_identity'] as const;
export type ThreatType = (typeof THREAT_TYPES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const RESOLUTIONS = ['handled', 'false_alarm'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** Steps a person can record on an alert that is not resolved yet, besides acknowledging and resolving it. */
export const RECORDED_ACTIONS = ['emergency_called', 'owner_informed', 'note'] as const;
export type RecordedAction = (typeof RECORDED_ACTIONS)[number];

/** Classes of the C4 detection model (v2, 9 classes), in training order. */
export const MODEL_CLASSES = ['person', 'vehicle', 'weapon', 'fire', 'smoke', 'tampering', 'loitering', 'face_covered', 'worker'] as const;

/**
 * Who is told at each severity, and how. Staff confirm before anyone outside is called (human in the loop), so a
 * false alarm never reaches the fire service, the police or a customer.
 */
export const NOTIFICATION_MATRIX: { severity: Severity; notify: string[]; how: string }[] = [
  { severity: 'low', notify: [], how: 'Logged on the Alerts screen only' },
  { severity: 'medium', notify: ['security_guard'], how: 'Alert on the Alerts screen' },
  {
    severity: 'high',
    notify: ['security_guard', 'bay_supervisor', 'centre_manager', 'vehicle_owner'],
    how: 'Alert on the screen and a message; the vehicle owner only after staff confirm',
  },
  {
    severity: 'critical',
    notify: ['security_guard', 'bay_supervisor', 'centre_manager', 'vehicle_owner', 'emergency_services'],
    how: 'Everyone above; a staff member calls the fire service or police after confirming',
  },
];

export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

/** e.g. SEC-26-000123: two-digit year (service centre time) and the alert id. */
export function formatAlertNo(id: number, at = new Date()): string {
  const year = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Colombo', year: '2-digit' }).format(at);
  return `SEC-${year}-${String(id).padStart(6, '0')}`;
}

type AlertState = { status: AlertStatus; severity: Severity; hasVehicle: boolean };

/** Why an action is not allowed on this alert, in words for the user; null when it is allowed. */
export function actionProblem(action: 'acknowledge' | 'resolve' | RecordedAction, a: AlertState): string | null {
  if (a.status === 'resolved') return 'This alert is already resolved.';
  if (action === 'acknowledge' && a.status !== 'open') return 'This alert is already acknowledged.';
  if (action === 'emergency_called' && severityRank(a.severity) < severityRank('high')) {
    return 'Emergency services are only called for high and critical alerts.';
  }
  if (action === 'owner_informed' && !a.hasVehicle) return 'No customer vehicle is affected by this alert.';
  return null;
}
