"""Service settings. Each one can be changed with an environment variable of the same name."""
import os
from pathlib import Path

COMPONENT_DIR = Path(__file__).resolve().parents[2]  # member-1-occupancy/
MODEL_DIR = COMPONENT_DIR / 'model'

# The fine-tuned vehicle model (from Kaggle). Until it exists, the COCO model is used and reported as a placeholder.
MODEL_PATH = Path(os.getenv('OCC_MODEL_PATH', MODEL_DIR / 'best.pt'))
MODEL_VERSION = os.getenv('OCC_MODEL_VERSION', 'AutoSense Bay Occupancy V1')  # training run pklot_yolo11s_1280
COCO_MODEL_PATH = MODEL_DIR / 'yolo11s.pt'
# Which model to run: auto = the fine-tuned one if model/best.pt exists, else the pretrained COCO model;
# pretrained = always the COCO model (e.g. for simulated close-up footage, where the fine-tuned model fails).
# The pretrained model is always reported as a placeholder ("not fine-tuned").
MODEL_CHOICE = os.getenv('OCC_MODEL', 'auto').strip().lower()
if MODEL_CHOICE not in ('auto', 'pretrained'):
    raise ValueError(f'OCC_MODEL must be auto or pretrained (got {MODEL_CHOICE!r}).')

IMGSZ = int(os.getenv('OCC_IMGSZ', '1280'))                 # must match the training imgsz
CONFIDENCE = float(os.getenv('OCC_CONFIDENCE', '0.25'))     # detections below this are ignored

# Grey out everything outside the bays before detection, as in training (see roi.py).
#   auto = on for the fine-tuned model (trained on masked images), off for the COCO placeholder; on / off = always.
ROI_MASK = os.getenv('OCC_ROI_MASK', 'auto').strip().lower()
if ROI_MASK not in ('auto', 'on', 'off'):
    raise ValueError(f'OCC_ROI_MASK must be auto, on or off (got {ROI_MASK!r}).')
# Number-plate reading (plates.py): auto = on when the OCR package is installed; on = required; off = never.
PLATES = os.getenv('OCC_PLATES', 'auto').strip().lower()
if PLATES not in ('auto', 'on', 'off'):
    raise ValueError(f'OCC_PLATES must be auto, on or off (got {PLATES!r}).')
# Margin around the bays, in pixels of a 1280 px wide frame (the PKLot/training size); scaled to the real frame
# width, at least 4 px (roi.margin_for). 0 = no margin.
ROI_MARGIN_PX = int(os.getenv('OCC_ROI_MARGIN_PX', '12'))

# Recorded videos may only be read from this folder (the API passes paths; the service never reads elsewhere).
VIDEO_DIR = Path(os.getenv('OCC_VIDEO_DIR', COMPONENT_DIR / 'videos')).resolve()
MAX_UPLOAD_MB = int(os.getenv('OCC_MAX_UPLOAD_MB', '15'))
