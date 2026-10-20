/*
    The roles AutoSense ships with. Applied on every `npm run db:migrate`; safe to re-run.
    - System administrator: every staff screen (its users are usually also super admins).
    - Staff: the daily-work (use) side of every feature, no setup or administration.
    - Customer: the customer pages. Every self-registered customer gets this role.
    - Bay operator and Technician (service flow, 0012) are ordinary roles: created here when missing, then managed in
      the app like any other. Their grants below are added once; nothing here changes an existing role.
    - Bay operator: the service floor: bookings, vehicle requests, check-in, the job list, bays (confirming which
      vehicle is in a bay, sending it for damage inspection, vehicle left) and inspection history.
    - Technician: damage inspections (create, review, confirm), the bay monitor, and marking work done.
    Administrators create other roles in the app (Administration > Roles) and tick their screens in Role permissions.

    Grants are only added here, never removed or switched back on: once an administrator changes a role's permissions,
    their change wins. Headers and groups need no grant; they show when the user can open one of their children.
*/
INSERT INTO app.roles (name, description, is_system, audience) VALUES
    ('System administrator', 'Everything in the staff app, including users, roles, settings and feature setup.', true, 'staff'),
    ('Staff',                'Daily work in every feature: bays, inspections, maintenance and safety. No setup or administration.', true, 'staff'),
    ('Customer',             'Vehicle owners: their own vehicles, confirmed inspection reports, recommendations and safety notices.', true, 'customer')
ON CONFLICT ((lower(name))) DO UPDATE SET description = EXCLUDED.description, is_system = true, audience = EXCLUDED.audience;

-- Service-flow roles: created when missing, never changed afterwards (a team member may have made one in the app first)
INSERT INTO app.roles (name, description, is_system, audience) VALUES
    ('Bay operator',         'Service floor: bookings, check-in, the queue and the bays, sending vehicles for damage inspection.', false, 'staff'),
    ('Technician',           'Damage inspections in the bays: photos, review and confirmation, and marking work done.', false, 'staff')
ON CONFLICT ((lower(name))) DO NOTHING;

WITH grants (role_name, screen_code) AS (
    SELECT 'System administrator', screen_code FROM app.screens
    WHERE audience = 'staff' AND NOT is_public AND (url IS NOT NULL OR show_on_menu = false)
    UNION ALL
    SELECT 'Staff', screen_code FROM app.screens
    WHERE audience = 'staff' AND access_level = 'use' AND NOT is_public AND (url IS NOT NULL OR show_on_menu = false)
    UNION ALL
    SELECT 'Customer', screen_code FROM app.screens
    WHERE audience = 'customer' AND NOT is_public
    UNION ALL
    SELECT 'Bay operator', unnest(ARRAY['BOOKINGS', 'VEHICLE_CLAIMS', 'JOBS', 'JOB_CHECK_IN', 'BAY_MONITOR', 'BAY_JOB_CONFIRM',
                                        'INSPECTION_HISTORY'])
    UNION ALL
    SELECT 'Technician', unnest(ARRAY['BAY_MONITOR', 'INSPECTION_CREATE', 'INSPECTION_REVIEW', 'INSPECTION_CONFIRM',
                                      'INSPECTION_HISTORY'])
)
INSERT INTO app.role_screens (role_id, screen_code)
SELECT r.role_id, g.screen_code
FROM grants g
JOIN app.roles r ON lower(r.name) = lower(g.role_name)
ON CONFLICT (role_id, screen_code) DO NOTHING;
