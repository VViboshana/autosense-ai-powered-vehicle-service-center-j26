/*
    The roles AutoSense ships with, and what each may open. Applied on every `npm run db:migrate`; safe to re-run.
    Grants are only added here, never removed or switched back on: once an administrator changes a role's permissions
    (Administration > Role permissions), their change wins. Groups and section headers need no grant; they show when
    the user can open one of their children. Super admins open every screen regardless of role.
*/
INSERT INTO app.roles (name, description, is_system) VALUES
    ('System administrator', 'Manages users, roles, settings, bays and cameras. Sees everything.', true),
    ('Service manager',      'Runs the service floor: all operational screens, reports and the audit log.', true),
    ('Service advisor',      'Checks vehicles in, starts inspections and keeps customers informed.', true),
    ('Technician',           'Inspects vehicles, reviews damage results and works the jobs in the bays.', true)
ON CONFLICT ((lower(name))) DO UPDATE SET description = EXCLUDED.description, is_system = true;

WITH grants (role_name, screen_code) AS (
    SELECT 'System administrator', screen_code FROM app.screens WHERE url IS NOT NULL OR show_on_menu = false
    UNION ALL
    SELECT 'Service manager', screen_code FROM app.screens
    WHERE (url IS NOT NULL OR show_on_menu = false) AND screen_code NOT IN ('USERS', 'ROLES', 'ROLE_PERMISSIONS', 'SETTINGS')
    UNION ALL
    SELECT 'Service advisor', unnest(ARRAY['BAY_MONITOR', 'JOBS', 'JOB_CHECK_IN', 'INSPECTION_CREATE', 'INSPECTION_HISTORY',
                                           'MAINTENANCE_FORECASTS', 'SERVICE_HISTORY'])
    UNION ALL
    SELECT 'Technician', unnest(ARRAY['BAY_MONITOR', 'JOBS', 'INSPECTION_CREATE', 'INSPECTION_REVIEW', 'INSPECTION_HISTORY',
                                      'INSPECTION_CONFIRM', 'MAINTENANCE_FORECASTS', 'SERVICE_HISTORY', 'SAFETY_ALERTS',
                                      'SAFETY_ALERT_ACK'])
)
INSERT INTO app.role_screens (role_id, screen_code)
SELECT r.role_id, g.screen_code
FROM grants g
JOIN app.roles r ON lower(r.name) = lower(g.role_name)
ON CONFLICT (role_id, screen_code) DO NOTHING;
