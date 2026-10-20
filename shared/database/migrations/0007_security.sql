/*
    security: vehicle security and safety alerts (component 4, owner: Viboshana T G V).

    The security service (YOLO11 + DeepSORT + rule engine) watches the premises cameras. The model detects
    person, vehicle, weapon, fire, smoke, tampering, loitering, face_covered and worker; the rule engine turns those
    detections, the camera zone and how long a track stays into one of the threats in security.threat_types, with a
    severity, who or what is affected, and who must be told. A person (guard / supervisor) then acknowledges and
    resolves every alert: the system flags, a person decides.

    Severity: low < medium < high < critical. Each threat has a base severity; escalation reasons (face covered,
    after hours, 2+ people, near a customer vehicle, ...) can raise it.
*/

-- Areas of the premises a camera covers. The zone type decides what a visitor (anyone not recognised as a worker)
-- may do there: public = allowed; work = only with a worker nearby; restricted = staff only.
CREATE TABLE security.zones (
    zone_id     serial       PRIMARY KEY,
    code        varchar(20)  NOT NULL UNIQUE,  -- e.g. 'RECEPTION'
    name        varchar(80)  NOT NULL,
    zone_type   varchar(12)  NOT NULL CHECK (zone_type IN ('public', 'work', 'restricted', 'parking')),
    description varchar(300) NOT NULL DEFAULT '',
    is_active   boolean      NOT NULL DEFAULT true
);

-- Security cameras (separate from the bay cameras of component 1, which only look at the service bays).
CREATE TABLE security.cameras (
    camera_id    serial       PRIMARY KEY,
    code         varchar(20)  NOT NULL UNIQUE,  -- e.g. 'SEC-01'
    name         varchar(80)  NOT NULL,
    zone_id      integer      REFERENCES security.zones (zone_id),
    location     varchar(120),
    source_url   varchar(500),                  -- RTSP address or a recorded file; never shown in the app
    status       varchar(10)  NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at timestamptz,
    is_active    boolean      NOT NULL DEFAULT true
);

-- The threat catalogue (T1..T7), filled from database/reference/050_security.sql.
CREATE TABLE security.threat_types (
    code          varchar(30)  PRIMARY KEY,     -- e.g. 'tampering'
    ref           varchar(5)   NOT NULL UNIQUE, -- e.g. 'T4' (as in the proposal)
    name          varchar(80)  NOT NULL,
    base_severity varchar(10)  NOT NULL CHECK (base_severity IN ('low', 'medium', 'high', 'critical')),
    detected_by   varchar(200) NOT NULL,        -- how it is detected: model class and/or rule
    escalation    varchar(300) NOT NULL DEFAULT '', -- when the severity is raised
    notify_roles  text[]       NOT NULL DEFAULT '{}', -- e.g. {security_guard, centre_manager}
    display_order integer      NOT NULL DEFAULT 0
);

CREATE TABLE security.alerts (
    alert_id           bigserial     PRIMARY KEY,
    alert_no           varchar(20)   NOT NULL UNIQUE,  -- e.g. 'SEC-26-000123'
    threat_type        varchar(30)   NOT NULL REFERENCES security.threat_types (code),
    severity           varchar(10)   NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    base_severity      varchar(10)   NOT NULL CHECK (base_severity IN ('low', 'medium', 'high', 'critical')),
    escalation_reasons text[]        NOT NULL DEFAULT '{}',  -- why it was raised above the base, in words
    confidence         numeric(4,3),                         -- model confidence of the main detection
    camera_id          integer       REFERENCES security.cameras (camera_id),
    zone_id            integer       REFERENCES security.zones (zone_id),
    detected_at        timestamptz   NOT NULL,
    last_seen_at       timestamptz,
    duration_s         integer,                              -- how long the threat was seen (persistence)
    person_role        varchar(10)   CHECK (person_role IN ('worker', 'visitor', 'unknown')),
    persons_involved   integer       NOT NULL DEFAULT 0,
    persons_affected   integer       NOT NULL DEFAULT 0,     -- people near the threat (e.g. near a fire)
    vehicle_id         integer       REFERENCES workshop.vehicles (vehicle_id),  -- affected vehicle, if any
    bay_id             integer       REFERENCES occupancy.bays (bay_id),
    job_id             integer       REFERENCES workshop.jobs (job_id) ON DELETE SET NULL,  -- the job may be removed; the alert stays
    detections         jsonb         NOT NULL DEFAULT '[]',  -- [{label, confidence, bbox:[x1,y1,x2,y2] 0..1}]
    summary            varchar(300)  NOT NULL DEFAULT '',    -- one line from the rule engine
    notify_roles       text[]        NOT NULL DEFAULT '{}',
    snapshot_key       varchar(300),                         -- stored frame; null when none was kept
    status             varchar(12)   NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    resolution         varchar(12)   CHECK (resolution IN ('handled', 'false_alarm')),
    resolution_note    varchar(500),
    acknowledged_by    integer       REFERENCES app.users (user_id),
    acknowledged_at    timestamptz,
    resolved_by        integer       REFERENCES app.users (user_id),
    resolved_at        timestamptz,
    model_version_id   integer       REFERENCES app.model_versions (model_version_id),
    event_id           bigint        REFERENCES app.events (event_id),  -- the security.alert event it came from
    created_at         timestamptz   NOT NULL DEFAULT now(),
    CHECK ((status = 'resolved') = (resolution IS NOT NULL))
);
CREATE INDEX ix_alerts_open ON security.alerts (severity, detected_at) WHERE status <> 'resolved';
CREATE INDEX ix_alerts_detected ON security.alerts (detected_at DESC);
CREATE INDEX ix_alerts_camera ON security.alerts (camera_id, detected_at DESC);

-- What happened to an alert, in order: raised, acknowledged, emergency services called, owner informed, notes,
-- resolved. The timeline on the alert page, and the evidence for the response-time evaluation.
CREATE TABLE security.alert_actions (
    action_id bigserial    PRIMARY KEY,
    alert_id  bigint       NOT NULL REFERENCES security.alerts (alert_id) ON DELETE CASCADE,
    action    varchar(20)  NOT NULL CHECK (action IN ('raised', 'escalated', 'acknowledged', 'emergency_called',
                                                      'owner_informed', 'note', 'resolved', 'false_alarm', 'reopened')),
    note      varchar(500),
    user_id   integer      REFERENCES app.users (user_id),  -- null for the security service
    at        timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_alert_actions_alert ON security.alert_actions (alert_id, at);
