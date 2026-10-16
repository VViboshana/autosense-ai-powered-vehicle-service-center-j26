/*
    SAMPLE DATA for development and demos only. Never run against a real service centre's database.
    Run with `npm run db:seed` (after db:migrate). Each run:
    - adds the demo users if missing (password from the seed runner: Demo@1234), customers, vehicles, cameras and bays;
    - replaces the sample day: demo jobs (JOB-DEMO-*), their inspections, bay states and bay history, all timed
      relative to now, so the dashboard shows a live-looking floor whenever you seed.
    The runner sets app.demo_password_hash before running this file.
*/
DO $$
DECLARE
    pw text := current_setting('app.demo_password_hash');
    cam_a int; cam_w int;
    bay int[] := ARRAY[]::int[];
    j int[] := ARRAY[]::int[];
    v int[] := ARRAY[]::int[];
    c int[] := ARRAY[]::int[];
    dilani int; ruwan int; ishara int; nimal int;
    mv int; ins int; img int;
    i int;
BEGIN
    -- Users (one per shipped role; the administrator is a super admin)
    INSERT INTO app.users (username, password_hash, first_name, last_name, email, designation, role_id, is_super_admin, must_change_password)
    SELECT u.username, pw, u.first_name, u.last_name, u.email, u.designation, r.role_id, u.super_admin, false
    FROM (VALUES
        ('admin',           'System', 'Administrator', 'admin@autosense.local',  'System administrator', 'System administrator', true),
        ('nimal.perera',    'Nimal',  'Perera',        'nimal@autosense.local',  'Service manager',      'Service manager',      false),
        ('dilani.fernando', 'Dilani', 'Fernando',      'dilani@autosense.local', 'Service advisor',      'Service advisor',      false),
        ('ruwan.silva',     'Ruwan',  'Silva',         'ruwan@autosense.local',  'Service advisor',      'Service advisor',      false),
        ('ishara.silva',    'Ishara', 'Silva',         'ishara@autosense.local', 'Technician',           'Technician',           false)
    ) AS u (username, first_name, last_name, email, designation, role_name, super_admin)
    JOIN app.roles r ON lower(r.name) = lower(u.role_name)
    ON CONFLICT ((lower(username))) DO NOTHING;

    SELECT user_id INTO nimal  FROM app.users WHERE username = 'nimal.perera';
    SELECT user_id INTO dilani FROM app.users WHERE username = 'dilani.fernando';
    SELECT user_id INTO ruwan  FROM app.users WHERE username = 'ruwan.silva';
    SELECT user_id INTO ishara FROM app.users WHERE username = 'ishara.silva';

    -- Customers and vehicles (sample people, Sri Lankan plate formats)
    INSERT INTO workshop.customers (customer_id, full_name, mobile, email) VALUES
        (1001, 'Kasun Perera',          '0771234501', NULL),
        (1002, 'Thilini Jayasinghe',    '0712345602', 'thilini.j@example.com'),
        (1003, 'Mohamed Rizwan',        '0753456703', NULL),
        (1004, 'Anjali Wickramasinghe', '0764567804', 'anjali.w@example.com'),
        (1005, 'Suresh Kumar',          '0775678905', NULL),
        (1006, 'Fathima Nazeer',        '0716789006', NULL),
        (1007, 'Chaminda Bandara',      '0727890107', NULL),
        (1008, 'Dinesh Rathnayake',     '0778901208', NULL)
    ON CONFLICT (customer_id) DO NOTHING;
    PERFORM setval(pg_get_serial_sequence('workshop.customers', 'customer_id'),
                   GREATEST((SELECT max(customer_id) FROM workshop.customers), 1));

    INSERT INTO workshop.vehicles (registration_no, make, model, year, colour, fuel_type, odometer_km, customer_id) VALUES
        ('WP CAB-4521', 'Toyota',     'Axio',     2016, 'Silver', 'petrol',   84200,  1001),
        ('CP KD-7716',  'Honda',      'Vezel',    2018, 'White',  'hybrid',   61500,  1002),
        ('WP CAR-8812', 'Toyota',     'Aqua',     2015, 'Blue',   'hybrid',   112300, 1003),
        ('WP CBD-1187', 'Suzuki',     'Wagon R',  2019, 'Red',    'petrol',   38900,  1004),
        ('NW LN-5543',  'Nissan',     'Leaf',     2017, 'White',  'electric', 58000,  1005),
        ('WP BHC-6620', 'Honda',      'Fit',      2014, 'Grey',   'petrol',   121900, 1006),
        ('WP LG-2290',  'Mitsubishi', 'Montero',  2012, 'Black',  'diesel',   176400, 1007),
        ('SP PH-3308',  'Toyota',     'Prius',    2015, 'Pearl',  'hybrid',   143300, 1008)
    ON CONFLICT ((upper(replace(registration_no, ' ', '')))) DO NOTHING;

    SELECT array_agg(vehicle_id ORDER BY o) INTO v FROM (
        SELECT vehicle_id, array_position(ARRAY['WPCAB-4521','CPKD-7716','WPCAR-8812','WPCBD-1187','NWLN-5543','WPBHC-6620','WPLG-2290','SPPH-3308'],
                                          upper(replace(registration_no, ' ', ''))) AS o
        FROM workshop.vehicles
        WHERE upper(replace(registration_no, ' ', '')) IN ('WPCAB-4521','CPKD-7716','WPCAR-8812','WPCBD-1187','NWLN-5543','WPBHC-6620','WPLG-2290','SPPH-3308')
    ) x;
    SELECT array_agg(customer_id ORDER BY o) INTO c FROM (
        SELECT customer_id, array_position(ARRAY['WPCAB-4521','CPKD-7716','WPCAR-8812','WPCBD-1187','NWLN-5543','WPBHC-6620','WPLG-2290','SPPH-3308'],
                                           upper(replace(registration_no, ' ', ''))) AS o
        FROM workshop.vehicles
        WHERE upper(replace(registration_no, ' ', '')) IN ('WPCAB-4521','CPKD-7716','WPCAR-8812','WPCBD-1187','NWLN-5543','WPBHC-6620','WPLG-2290','SPPH-3308')
    ) x;

    -- Cameras and bays (Workshop A: six bays under one camera; the wash bay camera is offline)
    INSERT INTO occupancy.cameras (code, name, location, status, last_seen_at) VALUES
        ('CAM-A', 'Workshop A', 'Bays 1 to 6, mounted above the main door', 'online', now()),
        ('CAM-W', 'Wash bay',   'Wash and detailing area',                  'offline', now() - interval '74 minutes')
    ON CONFLICT (code) DO UPDATE SET status = EXCLUDED.status, last_seen_at = EXCLUDED.last_seen_at;
    SELECT camera_id INTO cam_a FROM occupancy.cameras WHERE code = 'CAM-A';
    SELECT camera_id INTO cam_w FROM occupancy.cameras WHERE code = 'CAM-W';

    FOR i IN 0..5 LOOP
        INSERT INTO occupancy.bays (code, name, camera_id, display_order, polygon) VALUES (
            'B' || (i + 1), 'Bay ' || (i + 1), cam_a, i + 1,
            jsonb_build_array(
                jsonb_build_array(round(((160 + 80 * i) / 800.0)::numeric, 3), 0.333),
                jsonb_build_array(round(((240 + 80 * i) / 800.0)::numeric, 3), 0.333),
                jsonb_build_array(round(((146.67 + 126.67 * i) / 800.0)::numeric, 3), 0.889),
                jsonb_build_array(round(((20 + 126.67 * i) / 800.0)::numeric, 3), 0.889)))
        ON CONFLICT (code) DO NOTHING;
    END LOOP;
    SELECT array_agg(bay_id ORDER BY display_order) INTO bay FROM occupancy.bays WHERE code IN ('B1','B2','B3','B4','B5','B6');

    -- Model version placeholder: the inspections below are hand-made samples, not model output
    INSERT INTO app.model_versions (component, name, version, notes, is_active)
    VALUES ('damage', 'yolo11s-seg-cardd', '0.0.0-sample', 'Placeholder for sample records. No trained model yet.', false)
    ON CONFLICT (component, name, version) DO NOTHING;
    SELECT model_version_id INTO mv FROM app.model_versions WHERE component = 'damage' AND version = '0.0.0-sample';

    -- Replace the sample day
    DELETE FROM damage.detections WHERE image_id IN (
        SELECT im.image_id FROM damage.inspection_images im JOIN damage.inspections s USING (inspection_id)
        JOIN workshop.jobs jb ON jb.job_id = s.job_id WHERE jb.job_no LIKE 'JOB-DEMO-%');
    DELETE FROM damage.inspection_images WHERE inspection_id IN (
        SELECT s.inspection_id FROM damage.inspections s JOIN workshop.jobs jb ON jb.job_id = s.job_id WHERE jb.job_no LIKE 'JOB-DEMO-%');
    DELETE FROM damage.inspections WHERE job_id IN (SELECT job_id FROM workshop.jobs WHERE job_no LIKE 'JOB-DEMO-%');
    DELETE FROM workshop.job_stage_history WHERE job_id IN (SELECT job_id FROM workshop.jobs WHERE job_no LIKE 'JOB-DEMO-%');
    DELETE FROM workshop.jobs WHERE job_no LIKE 'JOB-DEMO-%';
    DELETE FROM occupancy.bay_state_events WHERE bay_id = ANY (bay) AND video_job_id IS NULL;

    -- Today's jobs (times relative to now)
    WITH ins AS (
        INSERT INTO workshop.jobs (job_no, vehicle_id, customer_id, service_type_id, stage, bay_id, advisor_user_id,
                                   estimate_lkr, estimated_minutes, checked_in_at, bay_entered_at, ready_at)
        SELECT d.job_no, v[d.k], c[d.k], st.service_type_id, d.stage, CASE WHEN d.b > 0 THEN bay[d.b] END,
               CASE d.adv WHEN 'D' THEN dilani ELSE ruwan END, d.est, d.mins,
               now() - make_interval(mins => d.in_ago),
               CASE WHEN d.bay_ago IS NOT NULL THEN now() - make_interval(mins => d.bay_ago) END,
               CASE WHEN d.ready_ago IS NOT NULL THEN now() - make_interval(mins => d.ready_ago) END
        FROM (VALUES
            ('JOB-DEMO-001', 1, 'BRAKE_SERVICE', 'in_bay',          1, 'D', 28500.00, 150, 52,  42,   NULL),
            ('JOB-DEMO-002', 2, 'FULL_SERVICE',  'in_bay',          2, 'D', 42750.00, 180, 67,  18,   NULL),
            ('JOB-DEMO-003', 3, 'OIL_CHANGE',    'waiting_for_bay', 0, 'R', 11200.00, 45,  31,  NULL, NULL),
            ('JOB-DEMO-004', 4, 'AC_REPAIR',     'inspected',       0, 'R', 19800.00, 75,  23,  NULL, NULL),
            ('JOB-DEMO-005', 5, 'EV_BATTERY',    'checked_in',      0, 'D', NULL,     NULL, 6,  NULL, NULL),
            ('JOB-DEMO-006', 6, 'BODY_REPAIR',   'ready',           0, 'R', 36400.00, 100, 125, 115,  15),
            ('JOB-DEMO-007', 7, 'ENGINE_REPAIR', 'in_bay',          4, 'D', 64500.00, 60,  80,  65,   NULL),
            ('JOB-DEMO-008', 8, 'HYBRID_CHECK',  'in_bay',          5, 'R', 9500.00,  90,  20,  7,    NULL)
        ) AS d (job_no, k, svc, stage, b, adv, est, mins, in_ago, bay_ago, ready_ago)
        JOIN workshop.service_types st ON st.code = d.svc
        RETURNING job_id, job_no
    )
    SELECT array_agg(job_id ORDER BY job_no) INTO j FROM ins;

    INSERT INTO workshop.job_stage_history (job_id, stage, at, user_id)
    SELECT job_id, 'checked_in', checked_in_at, advisor_user_id FROM workshop.jobs WHERE job_id = ANY (j)
    UNION ALL
    SELECT job_id, 'in_bay', bay_entered_at, ishara FROM workshop.jobs WHERE job_id = ANY (j) AND bay_entered_at IS NOT NULL
    UNION ALL
    SELECT job_id, 'ready', ready_at, ishara FROM workshop.jobs WHERE job_id = ANY (j) AND ready_at IS NOT NULL;

    -- Current bay states and the changes that led to them
    INSERT INTO occupancy.bay_status (bay_id, state, since, track_id, overlap, updated_at) VALUES
        (bay[1], 'occupied',  now() - interval '42 minutes', 17, 0.820, now()),
        (bay[2], 'occupied',  now() - interval '18 minutes', 21, 0.790, now()),
        (bay[3], 'free',      now() - interval '24 minutes', NULL, NULL, now()),
        (bay[4], 'occupied',  now() - interval '65 minutes', 9,  0.860, now()),
        (bay[5], 'occupied',  now() - interval '7 minutes',  23, 0.810, now()),
        (bay[6], 'uncertain', now() - interval '1 minute',   31, 0.380, now())
    ON CONFLICT (bay_id) DO UPDATE SET state = EXCLUDED.state, since = EXCLUDED.since, track_id = EXCLUDED.track_id,
        overlap = EXCLUDED.overlap, updated_at = EXCLUDED.updated_at;

    INSERT INTO occupancy.bay_state_events (bay_id, from_state, to_state, at, track_id, overlap, evidence) VALUES
        (bay[4], 'free',     'occupied',  now() - interval '65 minutes', 9,  0.860, 'present 6/6 samples (3 s)'),
        (bay[1], 'free',     'occupied',  now() - interval '42 minutes', 17, 0.820, 'present 6/6 samples (3 s)'),
        (bay[3], 'occupied', 'free',      now() - interval '24 minutes', NULL, NULL, 'absent 10/10 samples (5 s)'),
        (bay[2], 'free',     'occupied',  now() - interval '18 minutes', 21, 0.790, 'present 6/6 samples (3 s)'),
        (bay[5], 'free',     'occupied',  now() - interval '7 minutes',  23, 0.810, 'present 6/6 samples (3 s)'),
        (bay[6], 'free',     'uncertain', now() - interval '1 minute',   31, 0.380, 'vehicle 38% inside the bay line');

    -- Inspections: one confirmed, three awaiting review (sample regions, not model output)
    INSERT INTO damage.inspections (inspection_no, job_id, vehicle_id, status, overall_severity, severity_method, model_version_id,
                                    created_by, created_at, reviewed_by, reviewed_at)
    VALUES ('INS-0141', j[2], v[2], 'confirmed', 'minor', 'rule-v0', mv, dilani, now() - interval '60 minutes', ishara, now() - interval '50 minutes')
    ON CONFLICT (inspection_no) DO NOTHING;

    INSERT INTO damage.inspections (inspection_no, job_id, vehicle_id, status, overall_severity, severity_method, model_version_id, created_by, created_at)
    VALUES ('INS-0142', j[1], v[1], 'awaiting_review', 'moderate', 'rule-v0', mv, dilani, now() - interval '22 minutes')
    ON CONFLICT (inspection_no) DO NOTHING
    RETURNING inspection_id INTO ins;
    IF ins IS NOT NULL THEN
        INSERT INTO damage.inspection_images (inspection_id, view_angle, storage_key, width, height, quality, processing_ms)
        VALUES (ins, 'left', 'samples/ins-0142-left.jpg', 1280, 960,
                '{"passed": true, "blurVar": 143.2, "brightness": 0.52, "warnings": ["Glare on rear door may hide dents"]}', 412)
        RETURNING image_id INTO img;
        INSERT INTO damage.detections (image_id, label, confidence, bbox, polygon, area_px, area_ratio_vehicle, location, severity, severity_reason) VALUES
            (img, 'dent',        0.8100, '[717, 333, 861, 435]', '[[739,355],[819,342],[851,384],[829,426],[752,419],[723,387]]', 8650, 0.0340, 'rear door',  'moderate', 'Dent covering 3.4% of the vehicle'),
            (img, 'scratch',     0.7400, '[474, 371, 659, 422]', '[[480,400],[648,381],[653,394],[483,414]]',                     2810, 0.0110, 'front door', 'minor',    'Scratch covering 1.1% of the vehicle'),
            (img, 'lamp_broken', 0.6600, '[1114, 310, 1194, 365]', '[[1120,320],[1190,330],[1197,362],[1123,362]]',              1530, 0.0060, 'headlight',  'moderate', 'Broken lamp is functional damage');
    END IF;

    INSERT INTO damage.inspections (inspection_no, job_id, vehicle_id, status, overall_severity, severity_method, model_version_id, created_by, created_at)
    VALUES ('INS-0143', j[4], v[4], 'awaiting_review', 'minor', 'rule-v0', mv, ruwan, now() - interval '15 minutes')
    ON CONFLICT (inspection_no) DO NOTHING
    RETURNING inspection_id INTO ins;
    IF ins IS NOT NULL THEN
        INSERT INTO damage.inspection_images (inspection_id, view_angle, storage_key, width, height, quality, processing_ms)
        VALUES (ins, 'front', 'samples/ins-0143-front.jpg', 1280, 960, '{"passed": true, "blurVar": 188.0, "brightness": 0.61, "warnings": []}', 398)
        RETURNING image_id INTO img;
        INSERT INTO damage.detections (image_id, label, confidence, bbox, polygon, area_px, area_ratio_vehicle, location, severity, severity_reason)
        VALUES (img, 'scratch', 0.7700, '[402, 520, 610, 566]', '[[405,548],[606,524],[609,539],[408,562]]', 3100, 0.0090, 'front bumper', 'minor', 'Scratch covering 0.9% of the vehicle');
    END IF;

    INSERT INTO damage.inspections (inspection_no, job_id, vehicle_id, status, overall_severity, severity_method, model_version_id, created_by, created_at)
    VALUES ('INS-0144', j[3], v[3], 'awaiting_review', 'unavailable', 'rule-v0', mv, ruwan, now() - interval '9 minutes')
    ON CONFLICT (inspection_no) DO NOTHING
    RETURNING inspection_id INTO ins;
    IF ins IS NOT NULL THEN
        INSERT INTO damage.inspection_images (inspection_id, view_angle, storage_key, width, height, quality, processing_ms)
        VALUES (ins, 'rear', 'samples/ins-0144-rear.jpg', 1280, 960,
                '{"passed": false, "blurVar": 41.7, "brightness": 0.33, "warnings": ["Photo is blurry", "Photo is dark"]}', 377);
    END IF;
END
$$;
