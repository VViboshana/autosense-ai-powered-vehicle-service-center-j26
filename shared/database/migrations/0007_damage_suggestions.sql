/*
    damage: possible damage suggested by the model.

    Besides its findings, the damage service now returns weaker regions (confidence 0.10-0.25) as "possible damage",
    because the model misses subtle damage just below its normal threshold. A technician accepts a suggestion
    (review_status confirmed or corrected) or dismisses it (rejected). Suggestions do not count towards the
    severity, and are never shown to customers, unless accepted. Suggestions left undecided are dismissed when the
    inspection is confirmed, so the share of accepted suggestions can be measured.
*/
ALTER TABLE damage.detections ADD COLUMN is_suggestion boolean NOT NULL DEFAULT false;
