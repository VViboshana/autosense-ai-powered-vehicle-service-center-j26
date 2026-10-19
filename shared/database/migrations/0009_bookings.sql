/*
    Service bookings: a customer asks for a date and time for one of their vehicles; staff confirm or decline it.
    Times are the service centre's (setting app.timezone); which days and times can be booked, and how many vehicles
    each time can take, come from the setting bookings.rules (reference/030_settings.sql).
    Statuses: pending -> confirmed or declined (by staff); pending or confirmed -> cancelled (by the customer).

    app.users.notifications_seen_at: when the user last opened their notifications; newer ones show as unread.
*/
CREATE SEQUENCE workshop.booking_no_seq;

CREATE TABLE workshop.bookings (
    booking_id      serial       PRIMARY KEY,
    booking_no      varchar(20)  NOT NULL UNIQUE
                    DEFAULT 'BK-' || to_char(now(), 'YY') || '-' || lpad(nextval('workshop.booking_no_seq')::text, 6, '0'),
    customer_id     integer      NOT NULL REFERENCES workshop.customers (customer_id),
    vehicle_id      integer      NOT NULL REFERENCES workshop.vehicles (vehicle_id),
    service_type_id integer      NOT NULL REFERENCES workshop.service_types (service_type_id),
    booking_date    date         NOT NULL,
    slot_time       time         NOT NULL,
    customer_notes  varchar(500),
    status          varchar(12)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled')),
    staff_note      varchar(300),
    reviewed_by     integer      REFERENCES app.users (user_id),
    reviewed_at     timestamptz,
    cancelled_at    timestamptz,
    created_at      timestamptz  NOT NULL DEFAULT now()
);
-- Counting the bookings that hold a time
CREATE INDEX ix_bookings_slot ON workshop.bookings (booking_date, slot_time) WHERE status IN ('pending', 'confirmed');
CREATE INDEX ix_bookings_customer ON workshop.bookings (customer_id, booking_date DESC);
-- One open booking per vehicle per day
CREATE UNIQUE INDEX ux_bookings_vehicle_day ON workshop.bookings (vehicle_id, booking_date) WHERE status IN ('pending', 'confirmed');

ALTER TABLE app.users ADD COLUMN notifications_seen_at timestamptz;
