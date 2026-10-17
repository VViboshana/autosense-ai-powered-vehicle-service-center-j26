"""Service settings. Each one can be changed with an environment variable of the same name."""
import os
from pathlib import Path

COMPONENT_DIR = Path(__file__).resolve().parents[2]  # member-2-damage-assessment/
MODEL_DIR = COMPONENT_DIR / 'model'

# The trained damage model (from Kaggle). Until it exists, the COCO model is used so the pipeline can be tested.
MODEL_PATH = Path(os.getenv('DAMAGE_MODEL_PATH', MODEL_DIR / 'best.pt'))
FALLBACK_MODEL_PATH = MODEL_DIR / 'yolo11n-seg.pt'
MODEL_VERSION = os.getenv('DAMAGE_MODEL_VERSION', 'expA_yolo11n_640')

IMGSZ = int(os.getenv('DAMAGE_IMGSZ', '640'))                    # must match the training imgsz
CONFIDENCE = float(os.getenv('DAMAGE_CONFIDENCE', '0.25'))       # detections below this are dropped
MAX_UPLOAD_MB = int(os.getenv('DAMAGE_MAX_UPLOAD_MB', '15'))

# Photo quality limits (see quality.py)
MIN_SIDE_PX = 480
BLUR_MIN = 100.0                 # variance of the Laplacian; lower = blurrier
BRIGHTNESS_RANGE = (40.0, 220.0)  # mean grey level 0-255
