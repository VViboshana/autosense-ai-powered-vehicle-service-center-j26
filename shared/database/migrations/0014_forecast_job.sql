/*
    Maintenance forecasts join the service flow: check-in -> bay -> damage inspection -> maintenance forecast -> ready.

    A forecast made for a vehicle at the centre belongs to that visit's job (job_id), and links that job's confirmed
    damage inspection. A forecast made from a booking before the car arrives has no job yet: it stays a preliminary
    forecast for the booking.
*/
ALTER TABLE maintenance.forecasts ADD COLUMN job_id integer REFERENCES workshop.jobs (job_id);
CREATE INDEX ix_maintenance_forecasts_job ON maintenance.forecasts (job_id) WHERE job_id IS NOT NULL;
