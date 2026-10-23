/*
    Bay occupancy: a video job can replay a recorded video as a live camera (real time, looping, until staff stop it),
    which feeds the live bay pictures on the Bay monitor. It stands in for real camera streams until those are built
    (member 1, task 1). Recorded so a job's results are read correctly: live jobs have no end and no total frames.
*/
ALTER TABLE occupancy.video_jobs ADD COLUMN live boolean NOT NULL DEFAULT false;
