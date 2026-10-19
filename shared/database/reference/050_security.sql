/*
    Security component (C4) reference data. Applied on every `npm run db:migrate`, safe to re-run.
    - The threat catalogue T1..T7: base severity, how each is detected, when it is raised, who is told.
      Kept up to date from this file (the rule engine reads the same codes).
    - The rule settings (security.rules): thresholds the rule engine uses. An existing value is never overwritten,
      so a change made later survives re-runs.
*/
INSERT INTO security.threat_types (code, ref, name, base_severity, detected_by, escalation, notify_roles, display_order) VALUES
    ('fire', 'T1', 'Fire', 'critical',
     'Model: fire box',
     'Already the highest level.',
     '{security_guard,centre_manager,fire_service,vehicle_owner}', 1),
    ('smoke', 'T2', 'Smoke (no visible flame)', 'high',
     'Model: smoke box',
     'Critical when it is on or next to a vehicle, or lasts longer than 10 seconds.',
     '{security_guard,centre_manager,fire_service,vehicle_owner}', 2),
    ('weapon', 'T3', 'Weapon', 'critical',
     'Model: weapon box; rule: a weapon box touching or between two person boxes (weapon handed over)',
     'Already the highest level.',
     '{security_guard,centre_manager,police}', 3),
    ('tampering', 'T4', 'Vehicle tampering / theft', 'high',
     'Model: tampering box; rule: a visitor touching a vehicle door or window for longer than the set time',
     'Critical when the face is covered, after hours, or 2 or more people are involved.',
     '{security_guard,bay_supervisor,vehicle_owner}', 4),
    ('unauthorised_access', 'T5', 'Unauthorised access', 'medium',
     'Rule: a visitor inside a work bay or restricted zone with no worker nearby, or after hours',
     'High after hours, when the face is covered, or when entering a bay with a customer vehicle.',
     '{security_guard}', 5),
    ('loitering', 'T6', 'Loitering near a vehicle', 'low',
     'Model: loitering box; rule: a visitor near the same vehicle longer than the set time with no worker nearby (tracking time)',
     'Medium or high when the face is covered, near a customer vehicle, or repeated.',
     '{security_guard}', 6),
    ('concealed_identity', 'T7', 'Concealed identity', 'low',
     'Model: face_covered box',
     'Mainly raises the severity of T4 to T6; on its own it is logged.',
     '{security_guard}', 7)
ON CONFLICT (code) DO UPDATE SET
    ref = EXCLUDED.ref, name = EXCLUDED.name, base_severity = EXCLUDED.base_severity, detected_by = EXCLUDED.detected_by,
    escalation = EXCLUDED.escalation, notify_roles = EXCLUDED.notify_roles, display_order = EXCLUDED.display_order;

INSERT INTO app.settings (setting_key, value, description, is_public) VALUES
    ('security.rules',
     '{"persistenceSeconds": 2, "minConfidence": 0.45, "loiteringSeconds": 120, "touchSeconds": 10, "smokeCriticalSeconds": 10, "workerNearbyMetres": 3, "afterHours": {"from": "19:00", "to": "07:00"}}',
     'Security rule engine: how long a threat must be seen, minimum model confidence, loitering and touching times, smoke escalation, how near a worker must be, and the after-hours window', false)
ON CONFLICT (setting_key) DO NOTHING;
