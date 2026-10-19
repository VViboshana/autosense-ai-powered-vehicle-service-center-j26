/*
    SAMPLE DATA for the security component (C4), for development and demos only. Run with `npm run db:seed`, after
    100_demo.sql (it uses that file's vehicles, bays and JOB-DEMO-* jobs). Each run:
    - adds the sample zones and security cameras if missing (the wash bay camera is offline);
    - replaces the sample alerts (SEC-DEMO-*) and their timelines, timed relative to now.
    These alerts are hand-made, not model output: they use a placeholder model version and have no stored snapshot.
*/
DO $$
DECLARE
    mv int;
BEGIN
    INSERT INTO security.zones (code, name, zone_type, description) VALUES
        ('RECEPTION',   'Reception and waiting area', 'public',     'Customers wait here; visitors are allowed'),
        ('CAR_PARK',    'Customer car park',          'parking',    'Customer vehicles before and after service'),
        ('WORKSHOP_A',  'Workshop A (bays 1 to 6)',   'work',       'Visitors only with a worker nearby'),
        ('PARTS_STORE', 'Parts store',                'restricted', 'Staff only'),
        ('WASH_BAY',    'Wash and detailing bay',     'work',       'Visitors only with a worker nearby'),
        ('REAR_GATE',   'Rear gate and yard',         'restricted', 'Deliveries; staff only, closed after hours')
    ON CONFLICT (code) DO NOTHING;

    INSERT INTO security.cameras (code, name, zone_id, location, status, last_seen_at)
    SELECT d.code, d.name, z.zone_id, d.location, d.status, now() - make_interval(mins => d.seen_ago)
    FROM (VALUES
        ('SEC-01', 'Entrance',       'RECEPTION',   'Above the main entrance, facing reception', 'online',  0),
        ('SEC-02', 'Car park',       'CAR_PARK',    'Pole camera, covers all customer parking',  'online',  0),
        ('SEC-03', 'Workshop floor', 'WORKSHOP_A',  'Back wall of Workshop A, wide angle',       'online',  0),
        ('SEC-04', 'Parts store',    'PARTS_STORE', 'Inside the parts store door',               'online',  1),
        ('SEC-05', 'Wash bay',       'WASH_BAY',    'Wash and detailing area',                   'offline', 74),
        ('SEC-06', 'Rear gate',      'REAR_GATE',   'Rear gate, facing the yard',                'online',  0)
    ) AS d (code, name, zone, location, status, seen_ago)
    JOIN security.zones z ON z.code = d.zone
    ON CONFLICT (code) DO UPDATE SET status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at;

    INSERT INTO app.model_versions (component, name, version, notes, is_active)
    VALUES ('security', 'yolo11m-c4', '0.0.0-sample', 'Placeholder for sample records. Not output of a trained model.', false)
    ON CONFLICT (component, name, version) DO NOTHING;
    SELECT model_version_id INTO mv FROM app.model_versions WHERE component = 'security' AND version = '0.0.0-sample';

    -- Replace the sample alerts (their actions go with them: ON DELETE CASCADE)
    DELETE FROM security.alerts WHERE alert_no LIKE 'SEC-DEMO-%';

    WITH d (no, threat, severity, reasons, conf, cam, ago, dur, role, involved, affected, plate, summary, detections,
            status, ack_ago, res_ago, resolution, note) AS (VALUES
        ('SEC-DEMO-001', 'smoke', 'critical', '{"Next to a vehicle","Seen for longer than 10 seconds"}'::text[], 0.81, 'SEC-03', 4, 14,
         NULL, 0, 2, 'WPLG-2290', 'Smoke rising from the engine bay of the vehicle in Bay 4',
         '[{"label":"smoke","confidence":0.81,"bbox":[0.52,0.18,0.71,0.47]},{"label":"vehicle","confidence":0.93,"bbox":[0.44,0.38,0.80,0.86]},{"label":"person","confidence":0.88,"bbox":[0.28,0.30,0.37,0.84]},{"label":"worker","confidence":0.79,"bbox":[0.28,0.30,0.37,0.84]}]',
         'open', NULL, NULL, NULL, NULL),
        ('SEC-DEMO-002', 'tampering', 'critical', '{"Face covered","2 people involved"}'::text[], 0.74, 'SEC-02', 9, 38,
         'visitor', 2, 0, 'WPCAR-8812', 'Two visitors at the driver door of a parked customer vehicle, one with the face covered',
         '[{"label":"tampering","confidence":0.74,"bbox":[0.33,0.30,0.49,0.82]},{"label":"person","confidence":0.91,"bbox":[0.33,0.30,0.45,0.82]},{"label":"person","confidence":0.86,"bbox":[0.50,0.33,0.60,0.80]},{"label":"face_covered","confidence":0.66,"bbox":[0.36,0.31,0.40,0.39]},{"label":"vehicle","confidence":0.95,"bbox":[0.40,0.42,0.92,0.88]}]',
         'open', NULL, NULL, NULL, NULL),
        ('SEC-DEMO-003', 'unauthorised_access', 'medium', '{}'::text[], 0.88, 'SEC-04', 26, 45,
         'visitor', 1, 0, NULL, 'A visitor inside the parts store with no worker nearby',
         '[{"label":"person","confidence":0.88,"bbox":[0.41,0.22,0.55,0.90]}]',
         'acknowledged', 21, NULL, NULL, NULL),
        ('SEC-DEMO-004', 'loitering', 'medium', '{"Near a customer vehicle"}'::text[], 0.63, 'SEC-02', 17, 260,
         'visitor', 1, 0, 'WPBHC-6620', 'A visitor has stayed beside the same parked vehicle for over 4 minutes',
         '[{"label":"loitering","confidence":0.63,"bbox":[0.12,0.28,0.24,0.86]},{"label":"person","confidence":0.90,"bbox":[0.12,0.28,0.24,0.86]},{"label":"vehicle","confidence":0.94,"bbox":[0.22,0.40,0.66,0.85]}]',
         'open', NULL, NULL, NULL, NULL),
        ('SEC-DEMO-005', 'concealed_identity', 'low', '{}'::text[], 0.58, 'SEC-01', 38, 20,
         'visitor', 1, 0, NULL, 'A visitor with the face covered at reception',
         '[{"label":"face_covered","confidence":0.58,"bbox":[0.47,0.20,0.53,0.30]},{"label":"person","confidence":0.92,"bbox":[0.42,0.18,0.58,0.92]}]',
         'open', NULL, NULL, NULL, NULL),
        ('SEC-DEMO-006', 'weapon', 'critical', '{}'::text[], 0.52, 'SEC-06', 190, 6,
         'worker', 1, 0, NULL, 'Possible weapon carried through the rear gate',
         '[{"label":"weapon","confidence":0.52,"bbox":[0.58,0.48,0.64,0.62]},{"label":"person","confidence":0.89,"bbox":[0.50,0.25,0.66,0.93]},{"label":"worker","confidence":0.84,"bbox":[0.50,0.25,0.66,0.93]}]',
         'resolved', 186, 180, 'false_alarm', 'A mechanic carrying a tyre lever from the yard. Not a weapon.'),
        ('SEC-DEMO-007', 'loitering', 'low', '{}'::text[], 0.61, 'SEC-02', 300, 150,
         'visitor', 1, 0, NULL, 'A visitor has stayed in the car park for over 2 minutes',
         '[{"label":"loitering","confidence":0.61,"bbox":[0.70,0.30,0.80,0.84]},{"label":"person","confidence":0.87,"bbox":[0.70,0.30,0.80,0.84]}]',
         'resolved', 296, 290, 'handled', 'Customer waiting for a taxi. Spoke to them; no further action.'),
        ('SEC-DEMO-008', 'tampering', 'high', '{}'::text[], 0.69, 'SEC-03', 1210, 22,
         'visitor', 1, 0, 'WPCAB-4521', 'A visitor pulling at the door handle of a vehicle in Bay 1',
         '[{"label":"tampering","confidence":0.69,"bbox":[0.18,0.32,0.30,0.84]},{"label":"person","confidence":0.90,"bbox":[0.18,0.32,0.30,0.84]},{"label":"vehicle","confidence":0.92,"bbox":[0.24,0.42,0.62,0.88]}]',
         'resolved', 1207, 1195, 'handled', 'Owner came back for a bag left in the car; escorted by the bay supervisor.'),
        ('SEC-DEMO-009', 'fire', 'critical', '{}'::text[], 0.86, 'SEC-05', 2890, 9,
         NULL, 0, 1, NULL, 'Flames in the wash bay, near the waste bins',
         '[{"label":"fire","confidence":0.86,"bbox":[0.08,0.55,0.20,0.80]},{"label":"smoke","confidence":0.71,"bbox":[0.05,0.25,0.26,0.62]},{"label":"person","confidence":0.83,"bbox":[0.40,0.30,0.50,0.88]}]',
         'resolved', 2889, 2875, 'handled', 'Small fire in a waste bin, put out with an extinguisher. Fire service not needed.'),
        ('SEC-DEMO-010', 'unauthorised_access', 'high', '{"After hours"}'::text[], 0.84, 'SEC-06', 1460, 70,
         'visitor', 1, 0, NULL, 'A visitor entered the yard through the rear gate after closing time',
         '[{"label":"person","confidence":0.84,"bbox":[0.36,0.26,0.48,0.90]}]',
         'resolved', 1455, 1440, 'handled', 'Delivery driver who arrived late; checked his delivery note and let him leave.')
    ),
    ins AS (
        INSERT INTO security.alerts (alert_no, threat_type, severity, base_severity, escalation_reasons, confidence, camera_id, zone_id,
                                     detected_at, last_seen_at, duration_s, person_role, persons_involved, persons_affected,
                                     vehicle_id, bay_id, job_id, detections, summary, notify_roles, status, resolution, resolution_note,
                                     acknowledged_at, resolved_at, model_version_id, created_at)
        SELECT d.no, d.threat, d.severity, t.base_severity, d.reasons, d.conf, cam.camera_id, cam.zone_id,
               now() - make_interval(mins => d.ago), now() - make_interval(mins => d.ago) + make_interval(secs => d.dur), d.dur,
               d.role, d.involved, d.affected,
               v.vehicle_id, jb.bay_id, jb.job_id, d.detections::jsonb, d.summary, t.notify_roles, d.status, d.resolution, d.note,
               CASE WHEN d.ack_ago IS NOT NULL THEN now() - make_interval(mins => d.ack_ago) END,
               CASE WHEN d.res_ago IS NOT NULL THEN now() - make_interval(mins => d.res_ago) END,
               mv, now() - make_interval(mins => d.ago)
        FROM d
        JOIN security.threat_types t ON t.code = d.threat
        JOIN security.cameras cam ON cam.code = d.cam
        LEFT JOIN workshop.vehicles v ON upper(replace(v.registration_no, ' ', '')) = d.plate
        LEFT JOIN LATERAL (
            SELECT job_id, bay_id FROM workshop.jobs WHERE vehicle_id = v.vehicle_id AND job_no LIKE 'JOB-DEMO-%' LIMIT 1
        ) jb ON true
        RETURNING alert_id, detected_at, severity, base_severity, acknowledged_at, resolved_at, resolution, resolution_note
    ),
    -- The timeline: raised (by the security service), escalated, acknowledged, resolved / false alarm
    t AS (
        INSERT INTO security.alert_actions (alert_id, action, note, at)
        SELECT alert_id, 'raised', NULL, detected_at FROM ins
        UNION ALL
        SELECT alert_id, 'escalated', 'Raised from ' || base_severity || ' to ' || severity, detected_at FROM ins WHERE severity <> base_severity
        UNION ALL
        SELECT alert_id, 'acknowledged', NULL, acknowledged_at FROM ins WHERE acknowledged_at IS NOT NULL
        UNION ALL
        SELECT alert_id, CASE resolution WHEN 'false_alarm' THEN 'false_alarm' ELSE 'resolved' END, resolution_note, resolved_at
        FROM ins WHERE resolved_at IS NOT NULL
        RETURNING 1
    )
    SELECT count(*) INTO mv FROM t;
END $$;
