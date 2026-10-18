/*
    occupancy: cameras, service bays and their state (owner: bay occupancy component).
    Bay outlines are polygons in normalised frame coordinates (0..1), so they survive a change of video resolution.
    Bay states: free, occupied, uncertain (shown as "Confirming" in the app while a change is being confirmed).
*/
CREATE SCHEMA IF NOT EXISTS occupancy;

CREATE TABLE occupancy.cameras (
    camera_id    serial       PRIMARY KEY,
    code         varchar(20)  NOT NULL UNIQUE,  -- e.g. 'CAM-A'
    name         varchar(80)  NOT NULL,
    location     varchar(120),
    source_url   varchar(500),                  -- RTSP address or a recorded file; never shown to customers
    status       varchar(10)  NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
    last_seen_at timestamptz,
    is_active    boolean      NOT NULL DEFAULT true
);

CREATE TABLE occupancy.bays (
    bay_id        serial      PRIMARY KEY,
    code          varchar(10) NOT NULL UNIQUE,  -- e.g. 'B1'
    name          varchar(40) NOT NULL,         -- e.g. 'Bay 1'
    camera_id     integer     REFERENCES occupancy.cameras (camera_id),
    polygon       jsonb,                        -- [[x, y], ...] normalised 0..1; null until drawn
    display_order integer     NOT NULL DEFAULT 0,
    is_active     boolean     NOT NULL DEFAULT true
);

-- The current state of each bay (one row per bay), updated from bay.state events.
CREATE TABLE occupancy.bay_status (
    bay_id     integer      PRIMARY KEY REFERENCES occupancy.bays (bay_id),
    state      varchar(10)  NOT NULL CHECK (state IN ('free', 'occupied', 'uncertain')),
    since      timestamptz  NOT NULL,
    track_id   integer,
    overlap    numeric(4,3),
    updated_at timestamptz  NOT NULL DEFAULT now()
);

-- Processing of a recorded video (or a camera session), run by the occupancy service.
CREATE TABLE occupancy.video_jobs (
    video_job_id     serial       PRIMARY KEY,
    camera_id        integer      REFERENCES occupancy.cameras (camera_id),
    source_path      varchar(500) NOT NULL,
    sample_fps       numeric(4,2) NOT NULL DEFAULT 2,
    status           varchar(10)  NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
    frames_processed integer      NOT NULL DEFAULT 0,
    total_frames     integer,
    error            varchar(500),
    model_version_id integer      REFERENCES app.model_versions (model_version_id),
    created_by       integer      REFERENCES app.users (user_id),
    created_at       timestamptz  NOT NULL DEFAULT now(),
    started_at       timestamptz,
    finished_at      timestamptz
);

-- Every confirmed change of a bay's state; the history behind the timeline and the evaluation.
CREATE TABLE occupancy.bay_state_events (
    event_id     bigserial    PRIMARY KEY,
    bay_id       integer      NOT NULL REFERENCES occupancy.bays (bay_id),
    from_state   varchar(10)  CHECK (from_state IN ('free', 'occupied', 'uncertain')),
    to_state     varchar(10)  NOT NULL CHECK (to_state IN ('free', 'occupied', 'uncertain')),
    at           timestamptz  NOT NULL,
    track_id     integer,
    overlap      numeric(4,3),
    evidence     varchar(200),  -- e.g. 'present 14/15 samples'
    video_job_id integer      REFERENCES occupancy.video_jobs (video_job_id)
);
CREATE INDEX ix_bay_state_events_bay_time ON occupancy.bay_state_events (bay_id, at DESC);

ALTER TABLE workshop.jobs
    ADD CONSTRAINT fk_jobs_bay FOREIGN KEY (bay_id) REFERENCES occupancy.bays (bay_id);
