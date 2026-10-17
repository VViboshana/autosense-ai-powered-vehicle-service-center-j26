/*
    Access control, part 2: two kinds of user, sign-in sessions, and customers linking their vehicles.

    - Staff work in the staff app on every vehicle; customers (vehicle owners) see only their own vehicles at /my.
    - Each screen now says which feature it belongs to, whether it is daily work (use), setup (manage) or
      administration (admin), and who it is for (staff or customer). The Role permissions screen groups by these.
    - Sign-in uses server-side sessions: the browser holds a random token in an HttpOnly cookie; only its SHA-256 hash
      is stored here, so a session can be ended at once. The unused refresh-token table is dropped.
*/

-- Screens: owner becomes feature, plus level and audience
ALTER TABLE app.screens RENAME COLUMN owner TO feature;
ALTER TABLE app.screens
    ADD CONSTRAINT ck_screens_feature CHECK (feature IN ('shared', 'occupancy', 'damage', 'maintenance', 'security')),
    ADD COLUMN access_level varchar(10) NOT NULL DEFAULT 'use' CHECK (access_level IN ('use', 'manage', 'admin')),
    ADD COLUMN audience     varchar(10) NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff', 'customer'));

-- Roles are for staff or for customers; a role never mixes the two
ALTER TABLE app.roles
    ADD COLUMN audience varchar(10) NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff', 'customer'));

-- The shipped roles are now System administrator, Staff and Customer (database/reference/020_roles.sql).
-- The earlier ones stay as ordinary roles an administrator may change or remove.
UPDATE app.roles SET is_system = false
WHERE lower(name) IN ('service manager', 'service advisor', 'technician');

-- Users: staff or customer. A customer account always belongs to one customer record and is never a super admin.
ALTER TABLE app.users
    ADD COLUMN user_type   varchar(10) NOT NULL DEFAULT 'staff' CHECK (user_type IN ('staff', 'customer')),
    ADD COLUMN customer_id integer REFERENCES workshop.customers (customer_id),
    ADD CONSTRAINT ck_users_customer_link CHECK ((user_type = 'customer') = (customer_id IS NOT NULL)),
    ADD CONSTRAINT ck_users_customer_not_admin CHECK (user_type = 'staff' OR NOT is_super_admin);
CREATE UNIQUE INDEX ux_users_customer ON app.users (customer_id) WHERE customer_id IS NOT NULL;

-- Sessions
DROP TABLE app.refresh_tokens;
ALTER TABLE app.user_sessions
    ADD COLUMN token_hash   char(64)    NOT NULL UNIQUE,  -- SHA-256 of the cookie token
    ADD COLUMN expires_at   timestamptz NOT NULL,         -- hard limit, whatever the activity
    ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN end_reason   varchar(20) CHECK (end_reason IN ('signed_out', 'expired', 'idle', 'password_changed', 'deactivated', 'unlocked'));
CREATE INDEX ix_user_sessions_user_open ON app.user_sessions (user_id) WHERE ended_at IS NULL;

-- A customer asks to link a vehicle by its plate; staff check and approve it, so nobody can claim someone else's car.
CREATE TABLE workshop.vehicle_claims (
    claim_id        serial       PRIMARY KEY,
    customer_id     integer      NOT NULL REFERENCES workshop.customers (customer_id),
    registration_no varchar(20)  NOT NULL,
    vehicle_id      integer      REFERENCES workshop.vehicles (vehicle_id),  -- set when the plate matches a vehicle on record
    status          varchar(10)  NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    customer_note   varchar(300),
    review_note     varchar(300),
    requested_at    timestamptz  NOT NULL DEFAULT now(),
    reviewed_by     integer      REFERENCES app.users (user_id),
    reviewed_at     timestamptz
);
CREATE UNIQUE INDEX ux_vehicle_claims_open
    ON workshop.vehicle_claims (customer_id, upper(replace(replace(registration_no, ' ', ''), '-', '')))
    WHERE status = 'pending';
CREATE INDEX ix_vehicle_claims_pending ON workshop.vehicle_claims (requested_at) WHERE status = 'pending';

-- Customers sign in with their mobile number, so a number belongs to one customer
CREATE UNIQUE INDEX ux_customers_mobile ON workshop.customers (mobile) WHERE mobile IS NOT NULL;
