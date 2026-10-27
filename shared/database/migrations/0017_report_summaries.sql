/*
    "In plain words" summaries of confirmed inspection reports, for customers (damage assessment component, PP2).
    A language model (Gemini) rewords the report's confirmed facts in English, Sinhala or Tamil; each summary is written
    once per report and language and reused, while the facts it was written from (facts_hash) are unchanged. Only AI
    summaries are stored: the English template is rebuilt on every request. See backend/src/modules/my/my.summary.ts.
*/
CREATE TABLE damage.report_summaries (
    inspection_id integer      NOT NULL REFERENCES damage.inspections (inspection_id),
    language      varchar(2)   NOT NULL CHECK (language IN ('en', 'si', 'ta')),
    facts_hash    char(64)     NOT NULL,  -- sha256 of the facts sent to the model
    model         varchar(60)  NOT NULL,  -- e.g. gemini-3.5-flash
    method        varchar(20)  NOT NULL,  -- summary-v0
    summary       text         NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (inspection_id, language)
);
