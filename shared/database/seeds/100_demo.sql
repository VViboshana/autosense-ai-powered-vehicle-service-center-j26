/*
    STARTING SETUP for development: the workshop's cameras and service bays, nothing else.
    Run with `npm run db:seed` (after db:migrate). Safe to re-run: existing cameras and bays are left as they are.

    It creates no user accounts, roles, customers, vehicles, jobs or inspections. The first administrator is created on
    the setup page, the team in Administration › Users; customers sign up themselves, and vehicles, jobs and
    inspections are added through the app. (The earlier sample customers, vehicles, jobs and inspections were removed on
    19/10/2026 so that the demo shows only real records.)
*/
DO $$
DECLARE
    cam_a int;
    i int;
BEGIN
    -- Cameras: Workshop A watches bays 1 to 6; the wash bay camera has no bays yet
    INSERT INTO occupancy.cameras (code, name, location, status) VALUES
        ('CAM-A', 'Workshop A', 'Bays 1 to 6, mounted above the main door', 'online'),
        ('CAM-W', 'Wash bay',   'Wash and detailing area',                  'offline')
    ON CONFLICT (code) DO NOTHING;
    SELECT camera_id INTO cam_a FROM occupancy.cameras WHERE code = 'CAM-A';

    -- Six bays across Workshop A's view: each bay line as a polygon in 0-1 image coordinates
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
END
$$;
