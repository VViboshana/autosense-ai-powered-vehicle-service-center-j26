"""
AutoSense damage assessment service (component 2). Called only by the AutoSense API, never by the browser.

  GET  /health    200 when the models are loaded (the API's health check uses this)
  POST /predict   multipart photo -> quality check, vehicle, damage detections (findings + possible damage),
                  preliminary severity
  POST /analyze-audio  multipart recording + situation -> quality check, most likely fault (sound inspection)

Run (from member-2-damage-assessment/backend):  ..\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001
"""
import io
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from . import config, sound
from .findings import split_findings
from .predictor import SegModel, find_vehicle
from .quality import check_quality
from .severity import assess

state: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Loaded once at startup, reused for every request
    state['coco'] = SegModel(config.COCO_MODEL_PATH)
    state['placeholder'] = not config.MODEL_PATH.exists()
    state['damage'] = state['coco'] if state['placeholder'] else SegModel(config.MODEL_PATH)
    state['version'] = 'coco-placeholder' if state['placeholder'] else config.MODEL_VERSION
    # Sound inspection is optional: without acoustic/model/sound_classifier.joblib, /analyze-audio answers 503
    state['sound'] = sound.SoundModel(config.SOUND_MODEL_PATH) if config.SOUND_MODEL_PATH.exists() else None
    yield


app = FastAPI(title='AutoSense damage service', version='0.2.0', lifespan=lifespan)


def model_info() -> dict:
    return {'version': state['version'], 'placeholder': state['placeholder']}


@app.get('/health')
def health():
    return {'status': 'up', 'model': {**model_info(), 'classes': state['damage'].classes},
            'sound': {**state['sound'].info, 'situations': sound.classes.SITUATIONS} if state['sound'] else None}


@app.post('/predict')
def predict(
    image: UploadFile = File(..., description='Vehicle photo (JPEG or PNG)'),
    confidence: float = Query(config.CONFIDENCE, ge=0.05, le=0.95),
):
    started = time.perf_counter()
    data = image.file.read(config.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f'The photo is larger than {config.MAX_UPLOAD_MB} MB.')
    try:
        # exif_transpose: phones store photos sideways plus a "rotate" tag; apply it so boxes match what people see
        pil = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert('RGB')
    except (UnidentifiedImageError, OSError):
        raise HTTPException(400, 'The file is not a readable image (use JPEG or PNG).')
    bgr = np.ascontiguousarray(np.asarray(pil)[:, :, ::-1])  # OpenCV and YOLO expect BGR

    quality = check_quality(bgr)
    vehicle = find_vehicle(state['coco'], bgr)
    # One model run at the lower threshold; then findings (>= confidence) and possible damage (below it)
    regions = state['damage'].predict(bgr, min(config.POSSIBLE_CONFIDENCE, confidence))
    detections = split_findings(regions, confidence, config.MAX_POSSIBLE_PER_PHOTO)
    height, width = bgr.shape[:2]
    for d in detections:
        d['areaRatioImage'] = round(d['areaPx'] / (width * height), 4)
    severity = assess(detections, vehicle)

    return {
        'model': model_info(),
        'image': {'width': width, 'height': height},
        'quality': quality,
        'vehicle': vehicle,
        'detections': detections,
        'severity': severity,
        'processingMs': round((time.perf_counter() - started) * 1000),
    }


@app.post('/analyze-audio')
def analyze_audio(
    audio: UploadFile = File(..., description='Recording, 5-10 s (WAV, FLAC or OGG)'),
    situation: str = Query(..., pattern='^(starting|idling|braking)$', description='What the vehicle was doing'),
):
    if state['sound'] is None:
        raise HTTPException(503, 'Sound inspection is not installed (acoustic/model/sound_classifier.joblib is missing).')
    started = time.perf_counter()
    data = audio.file.read(config.MAX_AUDIO_MB * 1024 * 1024 + 1)
    if len(data) > config.MAX_AUDIO_MB * 1024 * 1024:
        raise HTTPException(413, f'The recording is larger than {config.MAX_AUDIO_MB} MB.')
    try:
        out = sound.analyze(state['sound'], data, situation)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {'model': state['sound'].info, **out, 'processingMs': round((time.perf_counter() - started) * 1000)}
