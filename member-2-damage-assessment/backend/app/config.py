"""Service settings. Each one can be changed with an environment variable of the same name."""
import os
from pathlib import Path

COMPONENT_DIR = Path(__file__).resolve().parents[2]  # member-2-damage-assessment/
MODEL_DIR = COMPONENT_DIR / 'model'

# The trained damage model (from Kaggle). Until it exists, the COCO model is used so the pipeline can be tested.
MODEL_PATH = Path(os.getenv('DAMAGE_MODEL_PATH', MODEL_DIR / 'best.pt'))
MODEL_VERSION = os.getenv('DAMAGE_MODEL_VERSION', 'expA_yolo11n_640')

# COCO model: finds the vehicle (for damage size relative to the vehicle) and stands in for best.pt until it exists.
COCO_MODEL_PATH = MODEL_DIR / 'yolo11n-seg.pt'
VEHICLE_CONFIDENCE = 0.4

IMGSZ = int(os.getenv('DAMAGE_IMGSZ', '640'))                    # must match the training imgsz
CONFIDENCE = float(os.getenv('DAMAGE_CONFIDENCE', '0.25'))       # detections from here up are findings
# Between this and CONFIDENCE: "possible damage" the technician can accept or dismiss (helps recall on subtle damage)
POSSIBLE_CONFIDENCE = float(os.getenv('DAMAGE_POSSIBLE_CONFIDENCE', '0.10'))
MAX_POSSIBLE_PER_PHOTO = int(os.getenv('DAMAGE_MAX_POSSIBLE', '5'))
MAX_UPLOAD_MB = int(os.getenv('DAMAGE_MAX_UPLOAD_MB', '15'))

# Photo quality limits (see quality.py)
MIN_SIDE_PX = 480
BLUR_MIN = 100.0                 # variance of the Laplacian; lower = blurrier
BRIGHTNESS_RANGE = (40.0, 220.0)  # mean grey level 0-255
