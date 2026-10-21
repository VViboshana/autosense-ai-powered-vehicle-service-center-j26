/*
    security: a camera's status now follows its recordings. A camera whose recording was analysed is online (set by
    the API when an analysis finishes); staff can Disconnect / Connect it from the Cameras screen. This brings existing
    cameras in line: any camera with an analysed recording is online.
*/
UPDATE security.cameras c
SET status = 'online', last_seen_at = now()
WHERE c.status = 'offline'
  AND EXISTS (SELECT 1 FROM security.video_analyses va WHERE va.camera_id = c.camera_id AND va.status = 'done' AND NOT va.is_synthetic);
