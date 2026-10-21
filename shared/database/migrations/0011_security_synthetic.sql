/*
    security: synthetic test videos (component 4). AI-generated or staged clips that show how the model works. They
    are analysed exactly like premises recordings, but they are not real incidents: they belong to no camera, and
    their alerts are kept out of the Alerts list, the alert figures and the camera counts (is_synthetic).
    expected_threat records what the clip was made to show, so the demo can compare it with what the model found.
*/
ALTER TABLE security.video_analyses
    ALTER COLUMN camera_id DROP NOT NULL,
    ADD COLUMN is_synthetic    boolean     NOT NULL DEFAULT false,
    ADD COLUMN title           varchar(120),
    ADD COLUMN expected_threat varchar(30) REFERENCES security.threat_types (code),
    ADD CONSTRAINT ck_video_camera CHECK (is_synthetic OR camera_id IS NOT NULL);

ALTER TABLE security.alerts
    ADD COLUMN is_synthetic boolean NOT NULL DEFAULT false;
CREATE INDEX ix_alerts_real_open ON security.alerts (severity, detected_at) WHERE status <> 'resolved' AND NOT is_synthetic;
