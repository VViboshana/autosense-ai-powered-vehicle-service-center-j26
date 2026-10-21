"""The Component 4 service for the AutoSense web app: the REST API in api.py (unchanged) plus what a browser needs.

  uvicorn c4security.service:app --port 8004

Added endpoints:
  DELETE /jobs/{job_id}              removes a finished job's outputs and its uploaded video (no copy is left behind).
  GET /jobs/{job_id}/browser-video   the annotated video as H.264 MP4, which browsers can play. The pipeline writes
                                     annotated.mp4 with the mp4v codec (fine for desktop players, not for Chrome or
                                     Safari), so it is converted once, after the job has finished, and kept beside it.
"""
from __future__ import annotations

import shutil
import threading
from pathlib import Path

import cv2
from fastapi import HTTPException
from fastapi.responses import FileResponse

from .api import DATA, app, jobs

BROWSER_VIDEO = "annotated_h264.mp4"
_convert_lock = threading.Lock()


def to_browser_mp4(src, dst) -> None:
    """Re-encodes a video as H.264 ('avc1') with OpenCV. Writes to a temporary name first, so a half-written file
    is never served."""
    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {src}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 15.0
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tmp = dst.with_name(dst.stem + ".part.mp4")
    out = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"avc1"), fps, (w, h))
    if not out.isOpened() and hasattr(cv2, "CAP_MSMF"):
        # Windows: the pip OpenCV build has no OpenH264, but Media Foundation (built into Windows) encodes H.264
        out = cv2.VideoWriter(str(tmp), cv2.CAP_MSMF, cv2.VideoWriter_fourcc(*"H264"), fps, (w, h))
    if not out.isOpened():
        cap.release()
        raise RuntimeError("this OpenCV build cannot write H.264")
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            out.write(frame)
    finally:
        cap.release()
        out.release()
    tmp.replace(dst)


@app.get("/jobs/{job_id}/browser-video")
def browser_video(job_id: str):
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "not found")
    if job["status"] == "running":
        raise HTTPException(409, "the job is still running")
    src = job["out"] / "annotated.mp4"
    if not src.is_file():
        raise HTTPException(404, "this job saved no video")
    dst = job["out"] / BROWSER_VIDEO
    with _convert_lock:
        if not dst.is_file():
            try:
                to_browser_mp4(src, dst)
            except RuntimeError as e:
                raise HTTPException(500, str(e)) from e
    return FileResponse(dst, media_type="video/mp4")


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    """Removes a finished job: its output folder (videos, snapshots, alerts) and its uploaded video. Called by the web
    app when a recording is deleted there, so no copy of the footage is left behind."""
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "not found")
    if job["status"] == "running":
        raise HTTPException(409, "the job is still running")
    out = job["out"].resolve()
    if out.parent == DATA.resolve() and out.is_dir():
        shutil.rmtree(out)
    source = Path(job["source"]).resolve()
    if (DATA / "uploads").resolve() in source.parents and source.is_file():
        source.unlink()
    jobs.pop(job_id, None)
    return {"job_id": job_id, "removed": True}
