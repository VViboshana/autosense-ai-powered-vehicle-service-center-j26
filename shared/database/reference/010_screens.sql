/*
    The screen registry: every screen and function in AutoSense. Applied on every `npm run db:migrate`; safe to re-run.
    Codes must match frontend/src/app/screens.tsx and the requireScreen() checks in the backend.

    Columns that matter when adding a row:
    - feature       shared | occupancy | damage | maintenance | security (who owns it; groups Role permissions)
    - access_level  use (daily work) | manage (setup of a feature) | admin (users, roles, settings, audit)
    - audience      staff (staff app) | customer (customer pages at /my); a role only ever gets screens of its audience
    - is_public     every signed-in user of that audience may open it, no grant needed
    - show_on_menu  false = a function: a grantable action without its own menu entry (e.g. INSPECTION_CONFIRM),
                    or a customer tab

    Menu rules (backend/src/modules/navigation/menu.ts):
    top level without url = section header · second level without url = expandable group · with url = link.

    To add a screen: add a row here, grant it in 020_roles.sql if a shipped role should have it, then follow
    docs/DEVELOPING.md. To retire one, set is_active = false; never delete (role grants point at it).
*/
INSERT INTO app.screens (screen_code, name, url, parent_code, icon, display_order, show_on_menu, is_public, feature, access_level, audience) VALUES
    -- Staff: daily work
    ('DASHBOARD',             'Dashboard',                 '/',                        NULL,             'bi-grid-1x2',           1,   true,  true,  'shared',      'use',    'staff'),

    ('SERVICE_FLOOR',         'Service floor',             NULL,                       NULL,             'bi-building-gear',      10,  true,  false, 'shared',      'use',    'staff'),
    ('BAY_MONITOR',           'Bay monitor',               '/floor/bays',              'SERVICE_FLOOR',  'bi-p-square',           11,  true,  false, 'occupancy',   'use',    'staff'),
    ('JOBS',                  'Vehicles & jobs',           '/floor/jobs',              'SERVICE_FLOOR',  'bi-car-front',          12,  true,  false, 'shared',      'use',    'staff'),
    ('JOB_CHECK_IN',          'Check in vehicles',         NULL,                       'SERVICE_FLOOR',  'bi-box-arrow-in-right', 13,  false, false, 'shared',      'use',    'staff'),
    ('BAY_JOB_CONFIRM',       'Confirm vehicles in bays',  NULL,                       'SERVICE_FLOOR',  'bi-box-arrow-in-down',  16,  false, false, 'occupancy',   'use',    'staff'),
    ('VEHICLE_CLAIMS',        'Customer vehicle requests', '/floor/vehicle-requests',  'SERVICE_FLOOR',  'bi-person-check',       14,  true,  false, 'shared',      'use',    'staff'),
    ('BOOKINGS',              'Service bookings',          '/floor/bookings',          'SERVICE_FLOOR',  'bi-calendar-check',     15,  true,  false, 'shared',      'use',    'staff'),

    ('INSPECTIONS',           'Inspections',               NULL,                       NULL,             'bi-clipboard-check',    20,  true,  false, 'damage',      'use',    'staff'),
    ('INSPECTION_CREATE',     'New inspection',            '/inspections/new',         'INSPECTIONS',    'bi-camera',             21,  true,  false, 'damage',      'use',    'staff'),
    ('INSPECTION_REVIEW',     'Review queue',              '/inspections/review',      'INSPECTIONS',    'bi-clipboard-check',    22,  true,  false, 'damage',      'use',    'staff'),
    ('INSPECTION_HISTORY',    'Inspection history',        '/inspections',             'INSPECTIONS',    'bi-clock-history',      23,  true,  false, 'damage',      'use',    'staff'),
    ('INSPECTION_CONFIRM',    'Confirm inspections',       NULL,                       'INSPECTIONS',    'bi-check2-all',         24,  false, false, 'damage',      'use',    'staff'),

    ('MAINTENANCE',           'Maintenance',               NULL,                       NULL,             'bi-wrench-adjustable',  30,  true,  false, 'maintenance', 'use',    'staff'),
    ('MAINTENANCE_FORECASTS', 'Forecasts',                 '/maintenance/forecasts',   'MAINTENANCE',    'bi-wrench-adjustable',  31,  true,  false, 'maintenance', 'use',    'staff'),
    ('SERVICE_HISTORY',       'Service history',           '/maintenance/history',     'MAINTENANCE',    'bi-journal-text',       32,  true,  false, 'maintenance', 'use',    'staff'),
    ('MAINTENANCE_ACCEPT',    'Accept suggestions',        NULL,                       'MAINTENANCE',    'bi-check2-square',      33,  false, false, 'maintenance', 'use',    'staff'),

    ('SAFETY',                'Safety',                    NULL,                       NULL,             'bi-shield-check',       40,  true,  false, 'security',    'use',    'staff'),
    ('SAFETY_ALERTS',         'Alerts',                    '/safety/alerts',           'SAFETY',         'bi-shield-exclamation', 41,  true,  false, 'security',    'use',    'staff'),
    ('CAMERAS',               'Cameras',                   '/safety/cameras',          'SAFETY',         'bi-camera-video',       42,  true,  false, 'security',    'use',    'staff'),
    ('SAFETY_ALERT_ACK',      'Acknowledge alerts',        NULL,                       'SAFETY',         'bi-check2-circle',      43,  false, false, 'security',    'use',    'staff'),

    -- Staff: setup of each feature, and administration
    ('MANAGE',                'Manage',                    NULL,                       NULL,             'bi-sliders',            90,  true,  false, 'shared',      'manage', 'staff'),
    ('REPORTS',               'Reports',                   '/reports',                 'MANAGE',         'bi-bar-chart-line',     91,  true,  false, 'shared',      'manage', 'staff'),
    ('SETUP',                 'Feature setup',             NULL,                       'MANAGE',         'bi-tools',              92,  true,  false, 'shared',      'manage', 'staff'),
    ('BAYS_CAMERAS',          'Bays & cameras',            '/setup/bays',              'SETUP',          'bi-bounding-box',       93,  true,  false, 'occupancy',   'manage', 'staff'),
    ('OCCUPANCY_SETTINGS',    'Occupancy settings',        '/setup/occupancy',         'SETUP',          'bi-p-square',           94,  true,  false, 'occupancy',   'manage', 'staff'),
    ('DAMAGE_SETTINGS',       'Damage settings',           '/setup/damage',            'SETUP',          'bi-clipboard-check',    95,  true,  false, 'damage',      'manage', 'staff'),
    ('MAINTENANCE_SETTINGS',  'Maintenance settings',      '/setup/maintenance',       'SETUP',          'bi-wrench-adjustable',  96,  true,  false, 'maintenance', 'manage', 'staff'),
    ('ALERT_RULES',           'Alert rules',               '/setup/alert-rules',       'SETUP',          'bi-shield-check',       97,  true,  false, 'security',    'manage', 'staff'),
    ('ADMINISTRATION',        'Administration',            NULL,                       'MANAGE',         'bi-gear',               100, true,  false, 'shared',      'admin',  'staff'),
    ('USERS',                 'Users',                     '/admin/users',             'ADMINISTRATION', 'bi-people',             101, true,  false, 'shared',      'admin',  'staff'),
    ('ROLES',                 'Roles',                     '/admin/roles',             'ADMINISTRATION', 'bi-person-badge',       102, true,  false, 'shared',      'admin',  'staff'),
    ('ROLE_PERMISSIONS',      'Role permissions',          '/admin/role-permissions',  'ADMINISTRATION', 'bi-diagram-3',          103, true,  false, 'shared',      'admin',  'staff'),
    ('SETTINGS',              'Settings',                  '/admin/settings',          'ADMINISTRATION', 'bi-sliders2',           104, true,  false, 'shared',      'admin',  'staff'),
    ('AUDIT_LOG',             'Audit log',                 '/admin/audit',             'ADMINISTRATION', 'bi-clock-history',      105, true,  false, 'shared',      'admin',  'staff'),

    -- Customer pages (/my). The vehicle page's tabs are grantable, so the admin can switch one off for customers.
    ('MY_HOME',               'Home',                      '/my',                      NULL,             'bi-house',              199, true,  true,  'shared',      'use',    'customer'),
    ('MY_VEHICLES',           'My vehicles',               '/my/vehicles',             NULL,             'bi-car-front',          200, true,  true,  'shared',      'use',    'customer'),
    ('MY_ACCOUNT',            'My account',                '/my/account',              NULL,             'bi-person',             201, true,  true,  'shared',      'use',    'customer'),
    ('MY_BOOKINGS',           'Bookings',                  '/my/bookings',             NULL,             'bi-calendar-check',     202, true,  true,  'shared',      'use',    'customer'),
    ('MY_HISTORY',            'Service history',           '/my/history',              NULL,             'bi-journal-text',       203, true,  true,  'shared',      'use',    'customer'),
    ('MY_VEHICLE_STATUS',     'Vehicle status & queue',    NULL,                       NULL,             'bi-p-square',           210, false, false, 'occupancy',   'use',    'customer'),
    ('MY_INSPECTIONS',        'Inspection reports',        NULL,                       NULL,             'bi-clipboard-check',    211, false, false, 'damage',      'use',    'customer'),
    ('MY_MAINTENANCE',        'Recommendations & history', NULL,                       NULL,             'bi-wrench-adjustable',  212, false, false, 'maintenance', 'use',    'customer'),
    ('MY_SAFETY_NOTICES',     'Safety notices',            NULL,                       NULL,             'bi-shield-check',       213, false, false, 'security',    'use',    'customer')
ON CONFLICT (screen_code) DO UPDATE SET
    name = EXCLUDED.name, url = EXCLUDED.url, parent_code = EXCLUDED.parent_code, icon = EXCLUDED.icon,
    display_order = EXCLUDED.display_order, show_on_menu = EXCLUDED.show_on_menu, is_public = EXCLUDED.is_public,
    feature = EXCLUDED.feature, access_level = EXCLUDED.access_level, audience = EXCLUDED.audience, is_active = true;
