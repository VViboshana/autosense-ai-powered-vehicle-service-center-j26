/*
    Default application settings. Applied on every `npm run db:migrate`; an existing value is never overwritten,
    so changes made in the app (Administration > Settings) survive re-runs.
    is_public = true: sent to the browser by GET /api/app-config (never put secrets in settings).
*/
INSERT INTO app.settings (setting_key, value, description, is_public) VALUES
    ('app.timezone',    '"Asia/Colombo"', 'Time zone for "today", dates and times shown in the app', true),
    ('app.date_format', '"dd/MM/yyyy"',   'How dates are shown', true),
    ('app.currency',    '"LKR"',          'Currency for estimates and invoices', true),
    ('damage.upload',
     '{"maxImageMb": 10, "maxImagesPerInspection": 3, "allowedTypes": ["image/jpeg", "image/png", "image/webp"]}',
     'Photo limits for a damage inspection', true),
    ('damage.severity',
     '{"method": "rule-v0", "validated": false}',
     'Severity estimation method in use; validated stays false until it is evaluated against technician labels', true),
    ('auth.password_policy',
     '{"minLength": 8, "minCharacterTypes": 3, "rememberLast": 3}',
     'Passwords: minimum length; how many of lower case, upper case, digits and symbols they must mix; how many previous passwords cannot be reused', true),
    ('auth.lockout',
     '{"maxFailedAttempts": 5}',
     'Wrong passwords in a row before an account is locked (an administrator unlocks it)', false),
    ('auth.sessions',
     '{"maxHours": 12, "idleMinutes": 120}',
     'Sign-in lasts at most maxHours, and ends after idleMinutes without activity', false),
    ('occupancy.rules',
     '{"overlapThreshold": 0.4, "confirmOccupiedSeconds": 3, "confirmFreeSeconds": 5, "sampleFps": 2}',
     'When a bay counts as occupied or free (used by the occupancy service)', false)
ON CONFLICT (setting_key) DO NOTHING;
