/*
    workshop: the service centre's day-to-day records, shared by every component.
    Customers, their vehicles, the types of service offered, and jobs (one visit of one vehicle).
    Keep customer data to what the service needs: no national ID numbers, no addresses.
*/
CREATE SCHEMA IF NOT EXISTS workshop;

CREATE TABLE workshop.customers (
    customer_id serial       PRIMARY KEY,
    full_name   varchar(120) NOT NULL,
    mobile      varchar(20),
    email       varchar(100),
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE workshop.vehicles (
    vehicle_id      serial      PRIMARY KEY,
    registration_no varchar(20) NOT NULL,  -- as on the plate, e.g. 'WP CAB-4521'
    make            varchar(40) NOT NULL,
    model           varchar(60) NOT NULL,
    year            smallint    CHECK (year BETWEEN 1950 AND 2100),
    colour          varchar(30),
    fuel_type       varchar(20) CHECK (fuel_type IN ('petrol', 'diesel', 'hybrid', 'electric', 'other')),
    odometer_km     integer     CHECK (odometer_km >= 0),
    customer_id     integer     REFERENCES workshop.customers (customer_id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_vehicles_registration ON workshop.vehicles (upper(replace(registration_no, ' ', '')));

CREATE TABLE workshop.service_types (
    service_type_id serial      PRIMARY KEY,
    code            varchar(30) NOT NULL UNIQUE,
    name            varchar(80) NOT NULL,
    default_minutes integer     NOT NULL CHECK (default_minutes > 0),
    is_active       boolean     NOT NULL DEFAULT true
);

-- One visit of one vehicle, from check-in to collection.
-- Stages, in order: checked_in -> inspected -> waiting_for_bay -> in_bay -> ready -> completed (or cancelled).
-- bay_id is linked to occupancy.bays in 0004_occupancy.sql.
CREATE TABLE workshop.jobs (
    job_id            serial        PRIMARY KEY,
    job_no            varchar(20)   NOT NULL UNIQUE,  -- e.g. 'JOB-26-000123'
    vehicle_id        integer       NOT NULL REFERENCES workshop.vehicles (vehicle_id),
    customer_id       integer       REFERENCES workshop.customers (customer_id),
    service_type_id   integer       NOT NULL REFERENCES workshop.service_types (service_type_id),
    stage             varchar(20)   NOT NULL DEFAULT 'checked_in'
                      CHECK (stage IN ('checked_in', 'inspected', 'waiting_for_bay', 'in_bay', 'ready', 'completed', 'cancelled')),
    bay_id            integer,
    advisor_user_id   integer       REFERENCES app.users (user_id),
    estimate_lkr      numeric(12,2) CHECK (estimate_lkr >= 0),
    estimated_minutes integer       CHECK (estimated_minutes > 0),  -- from the maintenance forecast, or the service default
    customer_notes    varchar(500),
    checked_in_at     timestamptz   NOT NULL DEFAULT now(),
    bay_entered_at    timestamptz,
    ready_at          timestamptz,
    completed_at      timestamptz,
    created_at        timestamptz   NOT NULL DEFAULT now(),
    updated_at        timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_jobs_checked_in ON workshop.jobs (checked_in_at DESC);
CREATE INDEX ix_jobs_stage ON workshop.jobs (stage) WHERE stage NOT IN ('completed', 'cancelled');

CREATE TABLE workshop.job_stage_history (
    history_id bigserial   PRIMARY KEY,
    job_id     integer     NOT NULL REFERENCES workshop.jobs (job_id),
    stage      varchar(20) NOT NULL,
    at         timestamptz NOT NULL DEFAULT now(),
    user_id    integer     REFERENCES app.users (user_id),
    note       varchar(300)
);
CREATE INDEX ix_job_stage_history_job ON workshop.job_stage_history (job_id, at);
