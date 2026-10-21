/*
    SAMPLE DATA for the security component (C4), for development and demos only. Run with `npm run db:seed`, after
    100_demo.sql (it uses that file's vehicles, bays and JOB-DEMO-* jobs). Each run:
    - adds the sample zones and security cameras if missing (a new wash bay camera starts offline);
    - removes the hand-made SEC-DEMO-* alerts of earlier versions. It adds no alerts: alerts only come from the model.
*/
DO $$
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
    -- An existing camera keeps its status: it is set by analysed recordings and Connect / Disconnect, not by the seed
    ON CONFLICT (code) DO NOTHING;

    -- No sample alerts: every alert comes from the trained model (recorded video analysis). This removes the
    -- hand-made SEC-DEMO-* alerts that earlier versions of this file created.
    DELETE FROM security.alerts WHERE alert_no LIKE 'SEC-DEMO-%';
END $$;
