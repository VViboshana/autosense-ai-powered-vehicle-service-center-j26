"""Service settings. Each one can be changed with an environment variable of the same name."""
import os
from pathlib import Path

COMPONENT_DIR = Path(__file__).resolve().parents[2]  # member-1-occupancy/
MODEL_DIR = COMPONENT_DIR / 'model'

# The fine-tuned vehicle model (from Kaggle). Until it exists, the COCO model is used and reported as a placeholder.
MODEL_PATH = Path(os.getenv('OCC_MODEL_PATH', MODEL_DIR / 'best.pt'))
MODEL_VERSION = os.getenv('OCC_MODEL_VERSION', 'pklot_yolo11s_1280')
COCO_MODEL_PATH = MODEL_DIR / 'yolo11s.pt'

IMGSZ = int(os.getenv('OCC_IMGSZ', '1280'))                 # must match the training imgsz
CONFIDENCE = float(os.getenv('OCC_CONFIDENCE', '0.25'))     # detections below this are ignored

# Recorded videos may only be read from this folder (the API passes paths; the service never reads elsewhere).
VIDEO_DIR = Path(os.getenv('OCC_VIDEO_DIR', COMPONENT_DIR / 'videos')).resolve()
MAX_UPLOAD_MB = int(os.getenv('OCC_MAX_UPLOAD_MB', '15'))
