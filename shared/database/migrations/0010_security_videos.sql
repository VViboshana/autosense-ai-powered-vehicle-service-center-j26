/*
    security: recorded video analysis (component 4). Staff upload a recorded clip for a security camera; the
    security service (member-4-anomaly-detection/service) runs the trained model, tracking and rule engine on it.
    The annotated video, the evidence snapshots and the alerts are then kept here, so they survive a restart of the
    service. Alerts found in a video are ordinary security.alerts rows, linked back to the video and the moment.
*/
CREATE TABLE security.video_analyses (
    video_analysis_id serial       PRIMARY KEY,
    camera_id         integer      NOT NULL REFERENCES security.cameras (camera_id),
    file_name         varchar(200) NOT NULL,
    file_size         bigint       NOT NULL,
    start_time        varchar(5),                    -- HH:MM clock time of the first frame, for the after-hours rule
    short_timings     boolean      NOT NULL DEFAULT false,  -- shorter loitering / touching times for short clips
    service_job_id    varchar(40),                   -- job id in the security service
    status            varchar(10)  NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    error             varchar(500),
    summary           jsonb,                         -- video seconds, processing seconds, people tracked, workers, alerts by threat
    alert_count       integer      NOT NULL DEFAULT 0,
    video_key         varchar(300),                  -- annotated H.264 video under UPLOAD_DIR; null until saved
    created_by        integer      REFERENCES app.users (user_id),
    created_at        timestamptz  NOT NULL DEFAULT now(),
    finished_at       timestamptz
);
CREATE INDEX ix_video_analyses_created ON security.video_analyses (created_at DESC);

ALTER TABLE security.alerts
    ADD COLUMN video_analysis_id integer REFERENCES security.video_analyses (video_analysis_id) ON DELETE SET NULL,
    ADD COLUMN video_time_s      numeric(8,1),       -- seconds into the video when the alert was raised
    ADD COLUMN source_alert_id   varchar(40);        -- the security service's own alert id
CREATE UNIQUE INDEX ux_alerts_video_source ON security.alerts (video_analysis_id, source_alert_id) WHERE video_analysis_id IS NOT NULL;
