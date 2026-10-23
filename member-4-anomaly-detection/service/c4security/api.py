"""REST service for the integrated AutoSense backend.

  uvicorn c4security.api:app --host 0.0.0.0 --port 8004

Environment (all optional):
  C4_MODEL        model weights        (default models/component4_best.pt)
  C4_RULES        rule file            (default configs/threat_rules.yaml)
  C4_ZONES_DIR    camera zone files    (default configs/zones; <camera_id>.yaml)
  C4_DATA_DIR     runs and alerts      (default runs/)
  C4_WEBHOOK_URL  POST every security.alert here (the integrated backend / event bus)
  C4_DEVICE       cpu | mps | 0 (GPU)  (default: best available)
"""
from __future__ import annotations

import logging
import os
import shutil
import threading
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import __version__
from .pipeline import DEFAULT_MODEL, DEFAULT_RULES, PKG, analyze, load_model

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
MODEL = Path(os.getenv("C4_MODEL", DEFAULT_MODEL))
RULES = Path(os.getenv("C4_RULES", DEFAULT_RULES))
ZONES_DIR = Path(os.getenv("C4_ZONES_DIR", PKG / "configs" / "zones"))
DATA = Path(os.getenv("C4_DATA_DIR", PKG / "runs"))
WEBHOOK = os.getenv("C4_WEBHOOK_URL") or None
DEVICE = os.getenv("C4_DEVICE") or None

app = FastAPI(title="AutoSense Component 4 — Vehicle Security", version=__version__)
jobs: dict[str, dict] = {}
recent = deque(maxlen=1000)                   # latest alerts of all jobs
bay_state: dict[str, dict[str, dict]] = {}   # camera_id -> zone -> bay info (from Component 1)
lock = threading.Lock()


class StreamRequest(BaseModel):
    source: str                       # rtsp://... , http://... , or "0" for a webcam
    camera_id: str
    save_video: bool = False


class BayState(BaseModel):
    """Component 1 `bay.state` event."""
    camera_id: str
    zone: str                         # bay / restricted zone name in the camera's zone file
    status: Literal["occupied", "free"]
    job_id: Optional[str] = None
    plate: Optional[str] = None
    owner_contact: Optional[str] = None


def zones_for(camera_id: str):
    f = ZONES_DIR / f"{camera_id}.yaml"
    if f.exists():
        return f
    return {"camera_id": camera_id}


def start_job(source, camera_id, *, live, save_video=True, start_time=None, overrides=()):
    jid = uuid.uuid4().hex[:10]
    job = {"job_id": jid, "camera_id": camera_id, "source": str(source), "live": live, "status": "running",
           "started_at": datetime.now().isoformat(timespec="seconds"), "summary": None, "error": None,
           "stop": threading.Event(), "engine": None, "out": DATA / jid}

    def ready(engine):
        job["engine"] = engine
        for zone, info in bay_state.get(camera_id, {}).items():
            engine.update_bay(zone, info)

    def run():
        try:
            job["summary"] = analyze(source, job["out"], model=load_model(MODEL), rules=RULES,
                                     zones=zones_for(camera_id), overrides=overrides, start_time=start_time,
                                     device=DEVICE, save_video=save_video, webhook_url=WEBHOOK,
                                     on_alert=lambda a: recent.append({**a, "job_id": jid}),
                                     stop_event=job["stop"], engine_ready=ready)
            job["status"] = "stopped" if job["stop"].is_set() else "done"
        except Exception as e:
            logging.exception("job %s failed", jid)
            job["status"], job["error"] = "failed", str(e)

    with lock:
        jobs[jid] = job
    threading.Thread(target=run, daemon=True).start()
    return jid


def public(job):
    return {k: (str(v) if k == "out" else v) for k, v in job.items() if k not in ("stop", "engine")}


@app.get("/health")
def health():
    return {"status": "ok", "component": 4, "version": __version__, "model": MODEL.name,
            "model_found": MODEL.exists(), "webhook": bool(WEBHOOK),
            "running_jobs": sum(j["status"] == "running" for j in jobs.values())}


@app.post("/analyze")
async def analyze_video(video: UploadFile = File(...), camera_id: str = Form("cam_01"),
                        start_time: Optional[str] = Form(None, description="HH:MM clock time of the first frame"),
                        save_video: bool = Form(True),
                        overrides: str = Form("", description="comma-separated, e.g. loitering.dwell_s=20")):
    """Upload a recorded video; returns a job id. Poll GET /jobs/{job_id}."""
    up = DATA / "uploads"
    up.mkdir(parents=True, exist_ok=True)
    path = up / f"{uuid.uuid4().hex[:8]}_{Path(video.filename or 'video.mp4').name}"
    with open(path, "wb") as fh:
        shutil.copyfileobj(video.file, fh)
    ov = [s.strip() for s in overrides.split(",") if s.strip()]
    return {"job_id": start_job(path, camera_id, live=False, save_video=save_video, start_time=start_time,
                                overrides=ov)}


@app.post("/streams")
def start_stream(req: StreamRequest):
    """Start watching a live camera (RTSP / HTTP / webcam). Runs until DELETE /streams/{job_id}."""
    return {"job_id": start_job(req.source, req.camera_id, live=True, save_video=req.save_video)}


@app.delete("/streams/{job_id}")
def stop_stream(job_id: str):
    job = jobs.get(job_id) or _404()
    job["stop"].set()
    return {"job_id": job_id, "status": "stopping"}


@app.get("/jobs")
def list_jobs():
    return [public(j) for j in jobs.values()]


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    return public(jobs.get(job_id) or _404())


@app.get("/jobs/{job_id}/files/{name:path}")
def job_file(job_id: str, name: str):
    """annotated.mp4, summary.md, alerts.jsonl or snapshots/NNN_<threat>.jpg"""
    job = jobs.get(job_id) or _404()
    f = (job["out"] / name).resolve()
    if job["out"].resolve() not in f.parents or not f.is_file():
        _404()
    return FileResponse(f)


@app.get("/alerts")
def get_alerts(camera_id: Optional[str] = None, severity: Optional[str] = None, job_id: Optional[str] = None,
               limit: int = 100):
    """Latest security.alert events, newest first."""
    out = [a for a in reversed(recent) if (not camera_id or a["camera_id"] == camera_id)
           and (not severity or a["severity"] == severity) and (not job_id or a["job_id"] == job_id)]
    return out[:limit]


@app.post("/bay-state")
def post_bay_state(ev: BayState):
    """Receive Component 1's bay.state: which job / plate is in which bay. Applied to running jobs at once."""
    info = None if ev.status == "free" else {k: v for k, v in ev.model_dump().items()
                                             if k in ("job_id", "plate", "owner_contact") and v}
    cam = bay_state.setdefault(ev.camera_id, {})
    if info:
        cam[ev.zone] = info
    else:
        cam.pop(ev.zone, None)
    for j in jobs.values():
        if j["camera_id"] == ev.camera_id and j["engine"] is not None and j["status"] == "running":
            j["engine"].update_bay(ev.zone, info)
    return {"camera_id": ev.camera_id, "bays": cam}


def _404():
    raise HTTPException(404, "not found")
