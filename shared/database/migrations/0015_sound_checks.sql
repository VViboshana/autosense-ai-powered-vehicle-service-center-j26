/*
    Sound inspection (damage assessment component, PP2). While creating an inspection the technician may record the
    vehicle starting, idling and/or braking (one recording per situation). The damage service's sound model names the
    most likely fault of that situation; a technician then confirms it, corrects it to another fault of the same
    situation, or rejects it, like a damage region. Sound findings are never stored as visual detections.

    Labels: member-2-damage-assessment/acoustic/classes.py (the same lists as SOUND_FAULTS in inspections.sound.ts).
    A recording the service could not use (silent, under 1 s) is refused when the inspection is created, so every row
    has a result.
*/
CREATE TABLE damage.sound_checks (
    sound_check_id   serial       PRIMARY KEY,
    inspection_id    integer      NOT NULL REFERENCES damage.inspections (inspection_id),
    situation        varchar(10)  NOT NULL CHECK (situation IN ('starting', 'idling', 'braking')),
    storage_key      varchar(300) NOT NULL,  -- path inside the upload store, never a full disk path
    duration_s       numeric(6,2),
    quality          jsonb        NOT NULL DEFAULT '{}',  -- { passed, usable, durationS, clippedRatio, rms, warnings[] }
    label            varchar(20)  NOT NULL CHECK (label IN ('normal_start', 'bad_ignition', 'dead_battery', 'normal_idle',
                                  'low_oil', 'power_steering', 'serpentine_belt', 'misfire', 'tappet', 'normal_brakes',
                                  'worn_brakes')),
    confidence       numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    sure             boolean      NOT NULL,  -- confidence at or above the service's "sure" level (0.7)
    probabilities    jsonb        NOT NULL DEFAULT '[]',  -- [{ label, probability }] for the situation's faults
    model_version_id integer      REFERENCES app.model_versions (model_version_id),
    processing_ms    integer,
    review_status    varchar(12)  NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'corrected', 'rejected')),
    corrected_label  varchar(20)  CHECK (corrected_label IN ('normal_start', 'bad_ignition', 'dead_battery', 'normal_idle',
                                  'low_oil', 'power_steering', 'serpentine_belt', 'misfire', 'tappet', 'normal_brakes',
                                  'worn_brakes')),
    reviewed_by      integer      REFERENCES app.users (user_id),
    reviewed_at      timestamptz,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    UNIQUE (inspection_id, situation)
);
