CREATE TABLE maintenance.forecasts (
    forecast_id          bigserial PRIMARY KEY,
    vehicle_id           integer NOT NULL REFERENCES workshop.vehicles(vehicle_id),
    customer_id          integer REFERENCES workshop.customers(customer_id),
    booking_id           integer REFERENCES workshop.bookings(booking_id),
    inspection_id        integer REFERENCES damage.inspections(inspection_id),
    created_by           integer NOT NULL REFERENCES app.users(user_id),
    predicted_category   varchar(80) NOT NULL,
    model_score          numeric(8,6) NOT NULL CHECK (model_score >= 0 AND model_score <= 1),
    category_scores      jsonb NOT NULL DEFAULT '{}',
    problem_description  varchar(2000) NOT NULL,
    severity             varchar(50) NOT NULL,
    service_history      jsonb NOT NULL DEFAULT '[]',
    selected_fix_title   varchar(300),
    estimated_hours      numeric(8,3),
    estimated_minutes    integer,
    duration_variant     varchar(80),
    duration_benchmark   boolean,
    duration_target_type varchar(100),
    technician_note      varchar(2000),
    status               varchar(20) NOT NULL DEFAULT 'preliminary'
                         CHECK (status IN ('preliminary', 'confirmed')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    confirmed_at         timestamptz,
    confirmed_by         integer REFERENCES app.users(user_id)
);
CREATE INDEX ix_maintenance_forecasts_vehicle ON maintenance.forecasts(vehicle_id, created_at DESC);
CREATE INDEX ix_maintenance_forecasts_booking ON maintenance.forecasts(booking_id) WHERE booking_id IS NOT NULL;
