/*
    The sound model's learning loop and its evidence (damage assessment component, PP2).

    - sound_checks.familiar / familiarity: the odd-sound check (acoustic/familiarity.py). A recording that does not sound
      like the training recordings is still answered, but marked not sure; null for results from before the check.
    - sound_training_runs: each "Retrain" an admin started: the run id the damage service gave it, how many confirmed
      app recordings it learned from, and its report (fair comparison current vs new; version number). A new version
      is used only after someone activates it (app.model_versions.is_active, name 'panns-mfcc-sound-classifier').
    - sound_lab_runs / sound_lab_items: Test lab. Labelled recordings uploaded only to test the active model (no
      inspection, no customer): the true fault next to the model's answer, kept as evidence.
*/
ALTER TABLE damage.sound_checks
    ADD COLUMN familiar    boolean,
    ADD COLUMN familiarity jsonb;  -- { familiar, vehicleScore, distance, vehicleThreshold, distanceThreshold, reasons[] }

CREATE TABLE damage.sound_training_runs (
    run_id         varchar(40)  PRIMARY KEY,  -- given by the damage service, e.g. 20261024-091500-ab12cd
    state          varchar(10)  NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'done', 'failed')),
    app_recordings integer      NOT NULL CHECK (app_recordings >= 0),
    version_no     integer,                   -- the version it produced (done only)
    report         jsonb,                     -- the run's report when done
    error          varchar(500),
    started_by     integer      NOT NULL REFERENCES app.users (user_id),
    started_at     timestamptz  NOT NULL DEFAULT now(),
    finished_at    timestamptz
);

CREATE TABLE damage.sound_lab_runs (
    lab_run_id    serial       PRIMARY KEY,
    name          varchar(100) NOT NULL,
    model_version varchar(40)  NOT NULL,      -- the sound model version that answered
    created_by    integer      NOT NULL REFERENCES app.users (user_id),
    created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE damage.sound_lab_items (
    lab_item_id     serial       PRIMARY KEY,
    lab_run_id      integer      NOT NULL REFERENCES damage.sound_lab_runs (lab_run_id),
    filename        varchar(200) NOT NULL,
    storage_key     varchar(300) NOT NULL,
    situation       varchar(10)  NOT NULL CHECK (situation IN ('starting', 'idling', 'braking')),
    true_label      varchar(20)  NOT NULL,    -- what the person uploading says the recording is
    predicted_label varchar(20),              -- null when the recording could not be used
    confidence      numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
    sure            boolean,
    familiar        boolean,
    quality         jsonb        NOT NULL DEFAULT '{}',
    probabilities   jsonb        NOT NULL DEFAULT '[]',
    processing_ms   integer
);
CREATE INDEX ix_sound_lab_items_run ON damage.sound_lab_items (lab_run_id);
