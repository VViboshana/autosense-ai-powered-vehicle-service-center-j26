/*
    app: what every part of AutoSense shares.
    - Access control (adapted from CleanBooks UM): a registry of screens and functions, roles, the screens each role
      may open, and users with one role each. Link rows are never deleted; they are switched off with is_active.
    - Sign-in sessions and refresh tokens (used by the login feature; nothing writes them yet).
    - Application settings, the audit log, the event log between components, and AI model versions.
*/
CREATE SCHEMA IF NOT EXISTS app;

-- Screens and functions. A row with show_on_menu = false is a function: a grantable action with no menu entry
-- (for example INSPECTION_CONFIRM). Menu levels: a top-level row without url is a section header; a second-level row
-- without url is an expandable group; anything with a url is a link. Three levels at most.
CREATE TABLE app.screens (
    screen_code   varchar(50)  PRIMARY KEY,
    name          varchar(100) NOT NULL,
    url           varchar(200),
    parent_code   varchar(50)  REFERENCES app.screens (screen_code),
    icon          varchar(50)  NOT NULL,
    display_order integer      NOT NULL,
    show_on_menu  boolean      NOT NULL,
    is_public     boolean      NOT NULL DEFAULT false,  -- open to every signed-in user, no grant needed
    owner         varchar(30)  NOT NULL DEFAULT 'shared', -- shared | occupancy | damage | maintenance | security
    is_active     boolean      NOT NULL DEFAULT true
);

CREATE TABLE app.roles (
    role_id     serial       PRIMARY KEY,
    name        varchar(100) NOT NULL,
    description varchar(500) NOT NULL DEFAULT '',
    is_system   boolean      NOT NULL DEFAULT false,  -- shipped roles; cannot be deleted
    status      smallint     NOT NULL DEFAULT 1 CHECK (status IN (1, 2)),  -- 1 active, 2 inactive
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_roles_name ON app.roles (lower(name));

CREATE TABLE app.role_screens (
    role_id     integer     NOT NULL REFERENCES app.roles (role_id),
    screen_code varchar(50) NOT NULL REFERENCES app.screens (screen_code),
    is_active   boolean     NOT NULL DEFAULT true,
    PRIMARY KEY (role_id, screen_code)
);

CREATE TABLE app.users (
    user_id              serial       PRIMARY KEY,
    username             varchar(50)  NOT NULL,
    password_hash        varchar(200) NOT NULL,
    password_changed_at  timestamptz  NOT NULL DEFAULT now(),
    first_name           varchar(50)  NOT NULL,
    last_name            varchar(50)  NOT NULL,
    email                varchar(100),
    mobile               varchar(20),
    employee_no          varchar(20),
    designation          varchar(60),
    role_id              integer      NOT NULL REFERENCES app.roles (role_id),
    status               smallint     NOT NULL DEFAULT 1 CHECK (status IN (1, 2, 3)),  -- 1 active, 2 locked, 3 inactive
    failed_attempts      integer      NOT NULL DEFAULT 0,
    is_super_admin       boolean      NOT NULL DEFAULT false,  -- every screen, regardless of role
    must_change_password boolean      NOT NULL DEFAULT true,
    last_login_at        timestamptz,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_users_username ON app.users (lower(username));

CREATE TABLE app.password_history (
    password_history_id bigserial    PRIMARY KEY,
    user_id             integer      NOT NULL REFERENCES app.users (user_id),
    password_hash       varchar(200) NOT NULL,
    changed_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE app.user_sessions (
    session_id  uuid        PRIMARY KEY,
    user_id     integer     NOT NULL REFERENCES app.users (user_id),
    ip_address  varchar(45),
    user_agent  varchar(300),
    started_at  timestamptz NOT NULL DEFAULT now(),
    ended_at    timestamptz
);

CREATE TABLE app.refresh_tokens (
    token_hash char(64)    PRIMARY KEY,  -- SHA-256 of the token; the token itself is never stored
    session_id uuid        NOT NULL REFERENCES app.user_sessions (session_id),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz
);

-- Application settings, one JSON value per key (e.g. 'occupancy.rules'). Changes apply immediately and are audited.
CREATE TABLE app.settings (
    setting_key varchar(100) PRIMARY KEY,
    value       jsonb        NOT NULL,
    description varchar(300) NOT NULL DEFAULT '',
    is_public   boolean      NOT NULL DEFAULT false,  -- returned to the browser by GET /api/app-config
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    updated_by  integer      REFERENCES app.users (user_id)
);

-- One audit trail for every table: what changed, by whom, with a snapshot of the record after the change.
CREATE TABLE app.audit_log (
    audit_id    bigserial    PRIMARY KEY,
    table_name  varchar(100) NOT NULL,
    record_id   varchar(50)  NOT NULL,
    action      varchar(60)  NOT NULL,
    snapshot    jsonb        NOT NULL,
    user_id     integer      REFERENCES app.users (user_id),
    at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_log_record ON app.audit_log (table_name, record_id);
CREATE INDEX ix_audit_log_at ON app.audit_log (at DESC);

-- AI models in use, per component. Every prediction stores the model_version_id that produced it.
CREATE TABLE app.model_versions (
    model_version_id serial       PRIMARY KEY,
    component        varchar(30)  NOT NULL CHECK (component IN ('occupancy', 'damage', 'maintenance', 'security')),
    name             varchar(100) NOT NULL,
    version          varchar(30)  NOT NULL,
    weights_sha256   char(64),
    metrics          jsonb        NOT NULL DEFAULT '{}',  -- measured evaluation results, with the dataset split used
    notes            varchar(500) NOT NULL DEFAULT '',
    is_active        boolean      NOT NULL DEFAULT false,
    registered_at    timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (component, name, version)
);

-- Events between components (bay.state, inspection.report, job.forecast, security.alert), as received.
CREATE TABLE app.events (
    event_id    bigserial    PRIMARY KEY,
    event_type  varchar(40)  NOT NULL CHECK (event_type IN ('bay.state', 'inspection.report', 'job.forecast', 'security.alert')),
    source      varchar(60)  NOT NULL,
    payload     jsonb        NOT NULL,
    occurred_at timestamptz  NOT NULL,
    received_at timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ix_events_type_time ON app.events (event_type, occurred_at DESC);
