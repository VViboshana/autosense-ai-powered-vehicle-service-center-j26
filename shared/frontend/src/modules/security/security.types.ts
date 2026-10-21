/** Shapes returned by /api/security (backend/src/modules/security/security.repository.ts). */
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type ThreatType = 'fire' | 'smoke' | 'weapon' | 'tampering' | 'unauthorised_access' | 'loitering' | 'concealed_identity';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';
export type Resolution = 'handled' | 'false_alarm';
export type AlertView = 'active' | 'resolved' | 'all';
export type ZoneType = 'public' | 'work' | 'restricted' | 'parking';

export type AlertListItem = {
  alertId: number;
  alertNo: string;
  threatType: ThreatType;
  threatName: string;
  severity: Severity;
  escalated: boolean;
  confidence: number | null;
  camera: string | null;
  zone: string | null;
  detectedAt: string;
  summary: string;
  personsInvolved: number;
  personsAffected: number;
  vehicle: { registrationNo: string; bay: string | null } | null;
  status: AlertStatus;
  resolution: Resolution | null;
};

export type Detection = { label: string; confidence: number; bbox: [number, number, number, number] };

export type AlertActionKind =
  | 'raised'
  | 'escalated'
  | 'acknowledged'
  | 'emergency_called'
  | 'owner_informed'
  | 'note'
  | 'resolved'
  | 'false_alarm'
  | 'reopened';

export type AlertDetail = AlertListItem & {
  threat: { ref: string; detectedBy: string; escalation: string };
  baseSeverity: Severity;
  escalationReasons: string[];
  lastSeenAt: string | null;
  durationS: number | null;
  personRole: 'worker' | 'visitor' | 'unknown' | null;
  cameraInfo: { code: string; name: string; location: string | null; status: 'online' | 'offline' } | null;
  zoneInfo: { code: string; name: string; zoneType: ZoneType } | null;
  affectedVehicle: { vehicleId: number; registrationNo: string; description: string; owner: string | null; bay: string | null; jobNo: string | null } | null;
  detections: Detection[];
  notifyRoles: string[];
  hasSnapshot: boolean;
  resolutionNote: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  model: { name: string; version: string } | null;
  actions: { action: AlertActionKind; note: string | null; by: string | null; at: string }[];
  /** Set when the alert was found in a recorded video. */
  video: { videoAnalysisId: number; fileName: string; timeS: number } | null;
};

export type SecuritySummary = {
  open: Record<Severity, number>;
  acknowledged: number;
  oldestOpenAt: string | null;
  today: { raised: number; resolved: number; falseAlarms: number };
  cameras: { online: number; total: number };
};

export type SecurityCamera = {
  cameraId: number;
  code: string;
  name: string;
  location: string | null;
  zone: { name: string; zoneType: ZoneType } | null;
  status: 'online' | 'offline';
  lastSeenAt: string | null;
  activeAlerts: number;
  worstActiveSeverity: Severity | null;
  alertsToday: number;
  lastAlertAt: string | null;
};

export type SecurityRules = {
  threats: {
    code: ThreatType;
    ref: string;
    name: string;
    baseSeverity: Severity;
    detectedBy: string;
    escalation: string;
    notifyRoles: string[];
  }[];
  zones: { code: string; name: string; zoneType: ZoneType; description: string; cameras: number }[];
  settings: {
    persistenceSeconds: number;
    minConfidence: number;
    loiteringSeconds: number;
    touchSeconds: number;
    smokeCriticalSeconds: number;
    workerNearbyMetres: number;
    afterHours: { from: string; to: string };
  };
  notificationMatrix: { severity: Severity; notify: string[]; how: string }[];
};

/** Recorded video analysis (GET /api/security/videos). */
export type VideoAnalysis = {
  videoAnalysisId: number;
  fileName: string;
  fileSize: number;
  camera: { cameraId: number; code: string; name: string; zone: string | null };
  startTime: string | null;
  shortTimings: boolean;
  status: 'running' | 'done' | 'failed';
  error: string | null;
  summary: { video_s?: number; processing_s?: number; frames?: number; tracked_people?: number; workers?: number; alerts?: number } | null;
  alertCount: number;
  hasVideo: boolean;
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type VideoAlert = AlertListItem & { videoTimeS: number; hasSnapshot: boolean; reasons: string[]; personRole: string | null };
export type VideoAnalysisDetail = VideoAnalysis & { alerts: VideoAlert[]; serviceReachable: boolean };

export type SecurityService = { online: boolean; modelFound: boolean; runningJobs: number; version: string | null };
