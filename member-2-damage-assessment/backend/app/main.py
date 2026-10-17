"""
AutoSense damage assessment service (component 2). Called only by the AutoSense API, never by the browser.

  GET  /health    200 when the model is loaded (the API's health check uses this)
  POST /predict   multipart photo -> quality check + damage detections

Run (from member-2-damage-assessment/backend):  ..\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001
"""
import io
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from . import config
from .predictor import DamagePredictor
from .quality import check_quality

state: dict = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state['predictor'] = DamagePredictor()  # loaded once at startup, reused for every request
    yield


app = FastAPI(title='AutoSense damage service', version='0.1.0', lifespan=lifespan)


@app.get('/health')
def health():
    p: DamagePredictor = state['predictor']
    return {'status': 'up', 'model': {'version': p.version, 'placeholder': p.placeholder, 'classes': p.classes}}


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

    p: DamagePredictor = state['predictor']
    quality = check_quality(bgr)
    detections = p.predict(bgr, confidence)
    height, width = bgr.shape[:2]
    for d in detections:
        d['areaRatioImage'] = round(d['areaPx'] / (width * height), 4)

    return {
        'model': {'version': p.version, 'placeholder': p.placeholder},
        'image': {'width': width, 'height': height},
        'quality': quality,
        'detections': detections,
        'processingMs': round((time.perf_counter() - started) * 1000),
    }
