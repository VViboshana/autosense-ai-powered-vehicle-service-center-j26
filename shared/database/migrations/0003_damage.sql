/*
    damage: vehicle damage inspections (owner: damage assessment component).
    An inspection has one or more photos; each photo has the damage regions the model found (or a technician added).
    Severity is the component's preliminary estimate until severity_validated is set by an evaluated method.
    Engine-sound (acoustic) findings will get their own table: they are never stored as visual detections.
*/
CREATE SCHEMA IF NOT EXISTS damage;

CREATE TABLE damage.inspections (
    inspection_id      serial      PRIMARY KEY,
    inspection_no      varchar(20) NOT NULL UNIQUE,  -- e.g. 'INS-0142'
    job_id             integer     REFERENCES workshop.jobs (job_id),
    vehicle_id         integer     NOT NULL REFERENCES workshop.vehicles (vehicle_id),
    status             varchar(20) NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'processing', 'awaiting_review', 'confirmed', 'failed')),
    overall_severity   varchar(12) CHECK (overall_severity IN ('minor', 'moderate', 'severe', 'unavailable')),
    severity_method    varchar(40),               -- e.g. 'rule-v0'
    severity_validated boolean     NOT NULL DEFAULT false,
    model_version_id   integer     REFERENCES app.model_versions (model_version_id),
    created_by         integer     REFERENCES app.users (user_id),
    created_at         timestamptz NOT NULL DEFAULT now(),
    reviewed_by        integer     REFERENCES app.users (user_id),
    reviewed_at        timestamptz,
    review_notes       varchar(1000)
);
CREATE INDEX ix_inspections_status ON damage.inspections (status, created_at);

CREATE TABLE damage.inspection_images (
    image_id      serial       PRIMARY KEY,
    inspection_id integer      NOT NULL REFERENCES damage.inspections (inspection_id),
    view_angle    varchar(10)  NOT NULL DEFAULT 'other' CHECK (view_angle IN ('front', 'rear', 'left', 'right', 'other')),
    storage_key   varchar(300) NOT NULL,  -- path inside the upload store, never a full disk path
    width         integer      CHECK (width > 0),
    height        integer      CHECK (height > 0),
    quality       jsonb        NOT NULL DEFAULT '{}',  -- { passed, blurVar, brightness, warnings[] }
    processing_ms integer,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Damage classes are the CarDD labels the model is trained on.
CREATE TABLE damage.detections (
    detection_id       serial       PRIMARY KEY,
    image_id           integer      NOT NULL REFERENCES damage.inspection_images (image_id),
    label              varchar(20)  NOT NULL
                       CHECK (label IN ('dent', 'scratch', 'crack', 'glass_shatter', 'lamp_broken', 'tire_flat')),
    confidence         numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),  -- null for regions added by a technician
    bbox               jsonb        NOT NULL,  -- [x1, y1, x2, y2] in image pixels
    polygon            jsonb,                  -- [[x, y], ...] in image pixels
    area_px            integer,
    area_ratio_vehicle numeric(6,4),           -- damaged area / vehicle area, when the vehicle was found
    location           varchar(40),            -- e.g. 'rear door'
    severity           varchar(12)  CHECK (severity IN ('minor', 'moderate', 'severe', 'unavailable')),
    severity_reason    varchar(200),
    source             varchar(12)  NOT NULL DEFAULT 'model' CHECK (source IN ('model', 'technician')),
    review_status      varchar(12)  NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'corrected', 'rejected')),
    corrected_label    varchar(20)  CHECK (corrected_label IN ('dent', 'scratch', 'crack', 'glass_shatter', 'lamp_broken', 'tire_flat')),
    corrected_severity varchar(12)  CHECK (corrected_severity IN ('minor', 'moderate', 'severe')),
    reviewed_by        integer      REFERENCES app.users (user_id),
    reviewed_at        timestamptz
);
CREATE INDEX ix_detections_image ON damage.detections (image_id);
