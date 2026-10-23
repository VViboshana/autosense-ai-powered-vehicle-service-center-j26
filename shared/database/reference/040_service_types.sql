/*
    Services the centre offers, with the usual time each takes (used until a maintenance forecast is available).
    Applied on every `npm run db:migrate`; safe to re-run.
*/
INSERT INTO workshop.service_types (code, name, default_minutes) VALUES
    ('FULL_SERVICE',   'Full service',          180),
    ('BRAKE_SERVICE',  'Brake service',         150),
    ('OIL_CHANGE',     'Oil & filter change',    45),
    ('BODY_REPAIR',    'Body repair',           360),
    ('AC_REPAIR',      'AC repair',              75),
    ('HYBRID_CHECK',   'Hybrid battery check',   90),
    ('EV_BATTERY',     'Battery health check',   60),
    ('ENGINE_REPAIR',  'Engine repair',         240),
    -- What the damage inspection can suggest besides body repair (member 2's repair guide, repair-v0)
    ('GLASS_REPLACEMENT', 'Glass replacement',  120),
    ('LIGHTING_REPAIR',   'Lighting repair',     60),
    ('TYRE_SERVICE',      'Tyre service',        30),
    -- What the sound inspection can suggest (member 2's mechanical guide, sound-repair-v0)
    ('BATTERY_SERVICE',   'Battery service',     45),
    ('STEERING_SERVICE',  'Steering service',    90),
    ('BELT_REPLACEMENT',  'Belt replacement',    60)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
