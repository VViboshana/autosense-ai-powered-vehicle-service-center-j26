/*
    Service flow: a booked or walk-in vehicle is checked in as a job, waits for a bay, goes into a bay, is inspected
    for damage, is finished and collected.

    Job stages, in order (the job keeps its bay from in_bay to inspected):
      checked_in -> waiting_for_bay -> in_bay -> inspecting -> inspected -> ready -> completed   (or cancelled)
    - inspecting (new): the bay operator sent the vehicle for damage inspection; it waits for or is under inspection.
    - inspected: the technician confirmed the inspection (component 2). Before this migration the stage list put
      inspected before waiting_for_bay; inspection now happens in the bay.

    Job numbers come from a sequence, like bookings (JOB-26-000123), continuing after any existing numbers.
    Bookings: checked_in = the customer arrived and the booking became a job (bookings.job_id).
*/
ALTER TABLE workshop.jobs DROP CONSTRAINT jobs_stage_check;
ALTER TABLE workshop.jobs ADD CONSTRAINT jobs_stage_check
    CHECK (stage IN ('checked_in', 'waiting_for_bay', 'in_bay', 'inspecting', 'inspected', 'ready', 'completed', 'cancelled'));

CREATE SEQUENCE workshop.job_no_seq;
SELECT setval('workshop.job_no_seq',
              greatest(1, coalesce((SELECT max(substring(job_no FROM '(\d+)$')::int) FROM workshop.jobs), 0)),
              (SELECT count(*) > 0 FROM workshop.jobs));
ALTER TABLE workshop.jobs ALTER COLUMN job_no
    SET DEFAULT 'JOB-' || to_char(now(), 'YY') || '-' || lpad(nextval('workshop.job_no_seq')::text, 6, '0');

ALTER TABLE workshop.bookings DROP CONSTRAINT bookings_status_check;
ALTER TABLE workshop.bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'checked_in'));
ALTER TABLE workshop.bookings ADD COLUMN job_id integer REFERENCES workshop.jobs (job_id);
ALTER TABLE workshop.bookings ADD COLUMN checked_in_at timestamptz;

-- One open job per vehicle: a vehicle cannot be checked in twice
CREATE UNIQUE INDEX ux_jobs_open_vehicle ON workshop.jobs (vehicle_id) WHERE stage NOT IN ('completed', 'cancelled');
