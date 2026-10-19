"""
AutoSense bay occupancy service (component 1). Called only by the AutoSense API, never by the browser.

  GET  /health                     200 when the model is loaded (the API's health check uses this)
  POST /analyze                    one image + bay outlines -> vehicles and a score/presence per bay (no history)
  POST /video-jobs                 start processing a recorded video with the given bays and rules
  GET  /video-jobs/{id}            status, progress, current bay states, transitions (?since=n for new ones only)
  POST /video-jobs/{id}/cancel
  GET  /snapshot?source=&at=       one JPEG frame of a video, for drawing bay outlines

Bay outlines are normalised [[x, y], ...] (0..1), as stored in occupancy.bays.polygon.

Run (from member-1-occupancy/backend):  ..\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8002
"""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager
from typing import Literal

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field, ValidationError, field_validator

from . import config
from .association import associate
from .detector import Detector
from .jobs import Job, JobManager
from .pipeline import BayConfig, read_frame, scale_polygon
from .state_machine import Rules

state: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Loaded once at startup, reused for every request
    state['placeholder'] = not config.MODEL_PATH.exists()
    state['detector'] = Detector(config.COCO_MODEL_PATH if state['placeholder'] else config.MODEL_PATH)
    state['version'] = 'coco-yolo11s-placeholder' if state['placeholder'] else config.MODEL_VERSION
    state['jobs'] = JobManager(state['detector'])
    yield
    state['jobs'].shutdown()


app = FastAPI(title='AutoSense occupancy service', version='0.1.0', lifespan=lifespan)


def model_info() -> dict:
    return {'version': state['version'], 'placeholder': state['placeholder'], 'imgsz': config.IMGSZ}


# ---------------------------------------------------------------- request bodies

class Bay(BaseModel):
    id: str = Field(min_length=1, max_length=20)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=50)

    @field_validator('polygon')
    @classmethod
    def normalised(cls, v):
        if any(not (0 <= x <= 1 and 0 <= y <= 1) for x, y in v):
            raise ValueError('polygon points must be normalised to 0..1')
        return v


class RulesIn(BaseModel):
    """The occupancy.rules setting (camelCase, as stored); omitted values keep the defaults."""
    overlapThreshold: float | None = Field(None, ge=0.05, le=0.95)
    releaseThreshold: float | None = Field(None, ge=0, le=0.95)
    confirmOccupiedSeconds: float | None = Field(None, gt=0, le=120)
    confirmFreeSeconds: float | None = Field(None, gt=0, le=120)
    toleranceSeconds: float | None = Field(None, ge=0, le=30)
    minSupport: float | None = Field(None, gt=0.5, le=1)
    staleAfterSeconds: float | None = Field(None, gt=0, le=600)

    def to_rules(self) -> Rules:
        try:
            return Rules.from_settings(self.model_dump(exclude_none=True))
        except ValueError as e:
            raise HTTPException(422, str(e))


class VideoJobIn(BaseModel):
    jobId: str = Field(min_length=1, max_length=40)
    source: str = Field(min_length=1, max_length=500, description='file name inside OCC_VIDEO_DIR, or rtsp://...')
    bays: list[Bay] = Field(min_length=1, max_length=32)
    rules: RulesIn = RulesIn()
    sampleFps: float = Field(2.0, gt=0, le=15)


def resolve_source(source: str) -> str:
    """Live streams pass through; files must sit inside OCC_VIDEO_DIR (the API cannot make the service read
    anything else on this computer)."""
    if source.startswith(('rtsp://', 'rtsps://')):
        return source
    path = (config.VIDEO_DIR / source).resolve()
    if config.VIDEO_DIR not in path.parents or not path.is_file():
        raise HTTPException(404, f'Video not found in the video folder: {source}')
    return str(path)


# ---------------------------------------------------------------- routes

@app.get('/health')
def health():
    jobs = state['jobs'].jobs.values()
    return {'status': 'up', 'model': model_info(),
            'jobsRunning': sum(j.status == 'running' for j in jobs), 'videoDir': str(config.VIDEO_DIR)}


@app.post('/analyze')
def analyze(
    image: UploadFile = File(..., description='Camera frame (JPEG or PNG)'),
    bays: str = Form(..., description='JSON list of {"id", "polygon": [[x, y], ...]} normalised 0..1'),
    method: Literal['coverage', 'iou', 'bottom_center'] = Query('coverage'),
    threshold: float = Query(0.4, ge=0.05, le=0.95),
    confidence: float = Query(config.CONFIDENCE, ge=0.05, le=0.95),
):
    started = time.perf_counter()
    try:
        bay_list = [Bay(**b) for b in json.loads(bays)]
    except (json.JSONDecodeError, TypeError, ValidationError) as e:
        raise HTTPException(422, f'bays must be a JSON list of {{id, polygon}}: {e}')
    data = image.file.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f'The image is larger than {config.MAX_UPLOAD_MB} MB.')
    bgr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise HTTPException(400, 'The file is not a readable image (use JPEG or PNG).')
    h, w = bgr.shape[:2]
    vehicles = state['detector'].detect(bgr, confidence)
    polys = {b.id: scale_polygon(b.polygon, w, h) for b in bay_list}
    matches = associate([v.bbox for v in vehicles], polys, method, threshold)
    return {
        'model': model_info(),
        'image': {'width': w, 'height': h},
        'method': method, 'threshold': threshold,
        'vehicles': [{'bbox': list(v.bbox), 'confidence': v.confidence} for v in vehicles],
        'bays': [{'id': m.bay_id, 'score': round(m.score, 3), 'present': m.present, 'vehicle': m.detection}
                 for m in matches],
        'processingMs': round((time.perf_counter() - started) * 1000),
    }


@app.post('/video-jobs', status_code=202)
def create_video_job(body: VideoJobIn):
    job = Job(body.jobId, resolve_source(body.source), [BayConfig(b.id, b.polygon) for b in body.bays],
              body.rules.to_rules(), body.sampleFps)
    try:
        state['jobs'].submit(job)
    except ValueError as e:
        raise HTTPException(409, str(e))
    return {'model': model_info(), **job.view()}


@app.get('/video-jobs/{job_id}')
def get_video_job(job_id: str, since: int = Query(0, ge=0)):
    job = state['jobs'].jobs.get(job_id)
    if job is None:
        raise HTTPException(404, 'No such video job (the service keeps jobs only until it restarts).')
    return job.view(since)


@app.post('/video-jobs/{job_id}/cancel')
def cancel_video_job(job_id: str):
    if job_id not in state['jobs'].jobs:
        raise HTTPException(404, 'No such video job.')
    return state['jobs'].cancel(job_id).view()


@app.get('/snapshot')
def snapshot(source: str = Query(..., max_length=500), at: float = Query(0.0, ge=0)):
    try:
        frame = read_frame(resolve_source(source), at)
    except ValueError as e:
        raise HTTPException(422, str(e))
    ok, jpg = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return Response(jpg.tobytes(), media_type='image/jpeg',
                    headers={'X-Frame-Width': str(frame.shape[1]), 'X-Frame-Height': str(frame.shape[0])})
