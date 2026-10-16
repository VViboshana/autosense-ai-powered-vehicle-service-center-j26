/*
    The screen registry: every screen and function in AutoSense. Applied on every `npm run db:migrate`; safe to re-run.
    Codes must match frontend/src/app/screens.ts and the requireScreen() checks in the backend.

    Menu rules (built by backend/src/modules/navigation):
    - top level, no url    -> section header (SERVICE_FLOOR ...); shown only if the user can open one of its children
    - second level, no url -> expandable group (ADMINISTRATION)
    - has a url            -> link
    - show_on_menu = false -> function: a grantable action with no menu entry (e.g. INSPECTION_CONFIRM)

    To add a screen: add a row here, grant it to roles in 020_roles.sql, then follow docs/DEVELOPING.md.
    To retire one, set is_active = false in a new row update; never delete (role grants point at it).
*/
INSERT INTO app.screens (screen_code, name, url, parent_code, icon, display_order, show_on_menu, is_public, owner) VALUES
    ('DASHBOARD',             'Dashboard',             '/',                        NULL,             'bi-grid-1x2',          1,  true,  true,  'shared'),

    ('SERVICE_FLOOR',         'Service floor',         NULL,                       NULL,             'bi-building-gear',     10, true,  false, 'shared'),
    ('BAY_MONITOR',           'Bay monitor',           '/floor/bays',              'SERVICE_FLOOR',  'bi-p-square',          11, true,  false, 'occupancy'),
    ('JOBS',                  'Vehicles & jobs',       '/floor/jobs',              'SERVICE_FLOOR',  'bi-car-front',         12, true,  false, 'shared'),
    ('JOB_CHECK_IN',          'Check in vehicles',     NULL,                       'SERVICE_FLOOR',  'bi-box-arrow-in-right',13, false, false, 'shared'),

    ('INSPECTIONS',           'Inspections',           NULL,                       NULL,             'bi-clipboard-check',   20, true,  false, 'damage'),
    ('INSPECTION_CREATE',     'New inspection',        '/inspections/new',         'INSPECTIONS',    'bi-camera',            21, true,  false, 'damage'),
    ('INSPECTION_REVIEW',     'Review queue',          '/inspections/review',      'INSPECTIONS',    'bi-clipboard-check',   22, true,  false, 'damage'),
    ('INSPECTION_HISTORY',    'Inspection history',    '/inspections',             'INSPECTIONS',    'bi-clock-history',     23, true,  false, 'damage'),
    ('INSPECTION_CONFIRM',    'Confirm inspections',   NULL,                       'INSPECTIONS',    'bi-check2-all',        24, false, false, 'damage'),

    ('MAINTENANCE',           'Maintenance',           NULL,                       NULL,             'bi-wrench-adjustable', 30, true,  false, 'maintenance'),
    ('MAINTENANCE_FORECASTS', 'Forecasts',             '/maintenance/forecasts',   'MAINTENANCE',    'bi-wrench-adjustable', 31, true,  false, 'maintenance'),
    ('SERVICE_HISTORY',       'Service history',       '/maintenance/history',     'MAINTENANCE',    'bi-journal-text',      32, true,  false, 'maintenance'),

    ('SAFETY',                'Safety',                NULL,                       NULL,             'bi-shield-check',      40, true,  false, 'security'),
    ('SAFETY_ALERTS',         'Alerts',                '/safety/alerts',           'SAFETY',         'bi-shield-exclamation',41, true,  false, 'security'),
    ('CAMERAS',               'Cameras',               '/safety/cameras',          'SAFETY',         'bi-camera-video',      42, true,  false, 'security'),
    ('SAFETY_ALERT_ACK',      'Acknowledge alerts',    NULL,                       'SAFETY',         'bi-check2-circle',     43, false, false, 'security'),

    ('MANAGE',                'Manage',                NULL,                       NULL,             'bi-sliders',           90, true,  false, 'shared'),
    ('REPORTS',               'Reports',               '/reports',                 'MANAGE',         'bi-bar-chart-line',    91, true,  false, 'shared'),
    ('ADMINISTRATION',        'Administration',        NULL,                       'MANAGE',         'bi-gear',              92, true,  false, 'shared'),
    ('USERS',                 'Users',                 '/admin/users',             'ADMINISTRATION', 'bi-people',            93, true,  false, 'shared'),
    ('ROLES',                 'Roles',                 '/admin/roles',             'ADMINISTRATION', 'bi-person-badge',      94, true,  false, 'shared'),
    ('ROLE_PERMISSIONS',      'Role permissions',      '/admin/role-permissions',  'ADMINISTRATION', 'bi-diagram-3',         95, true,  false, 'shared'),
    ('BAYS_CAMERAS',          'Bays & cameras',        '/admin/bays',              'ADMINISTRATION', 'bi-bounding-box',      96, true,  false, 'occupancy'),
    ('SETTINGS',              'Settings',              '/admin/settings',          'ADMINISTRATION', 'bi-sliders2',          97, true,  false, 'shared'),
    ('AUDIT_LOG',             'Audit log',             '/admin/audit',             'ADMINISTRATION', 'bi-clock-history',     98, true,  false, 'shared')
ON CONFLICT (screen_code) DO UPDATE SET
    name = EXCLUDED.name, url = EXCLUDED.url, parent_code = EXCLUDED.parent_code, icon = EXCLUDED.icon,
    display_order = EXCLUDED.display_order, show_on_menu = EXCLUDED.show_on_menu, is_public = EXCLUDED.is_public,
    owner = EXCLUDED.owner, is_active = true;
