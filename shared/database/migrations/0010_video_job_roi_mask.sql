/*
    Bay occupancy: record for each video job whether the occupancy service greyed out everything outside the bays
    before detection (ROI masking, member-1-occupancy/backend/app/roi.py). The fine-tuned model only works on masked
    frames, so a job's results can only be interpreted or reproduced knowing this (NFR-13).
    Null = not reported: jobs started before this migration, or by a service version without masking.
*/
ALTER TABLE occupancy.video_jobs ADD COLUMN roi_mask boolean;
