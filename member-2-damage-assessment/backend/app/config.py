"""Service settings. Each one can be changed with an environment variable of the same name."""
import os
from pathlib import Path

COMPONENT_DIR = Path(__file__).resolve().parents[2]  # member-2-damage-assessment/
MODEL_DIR = COMPONENT_DIR / 'model'

# The trained damage model (from Kaggle). Until it exists, the COCO model is used so the pipeline can be tested.
MODEL_PATH = Path(os.getenv('DAMAGE_MODEL_PATH', MODEL_DIR / 'best.pt'))
MODEL_VERSION = os.getenv('DAMAGE_MODEL_VERSION', 'AutoSense Damage Detection V1')  # training run expA_yolo11n_640

# COCO model: finds the vehicle (for damage size relative to the vehicle) and stands in for best.pt until it exists.
COCO_MODEL_PATH = MODEL_DIR / 'yolo11n-seg.pt'
VEHICLE_CONFIDENCE = 0.4

IMGSZ = int(os.getenv('DAMAGE_IMGSZ', '640'))                    # must match the training imgsz
CONFIDENCE = float(os.getenv('DAMAGE_CONFIDENCE', '0.25'))       # detections from here up are findings
# Between this and CONFIDENCE: "possible damage" the technician can accept or dismiss (helps recall on subtle damage)
POSSIBLE_CONFIDENCE = float(os.getenv('DAMAGE_POSSIBLE_CONFIDENCE', '0.10'))
MAX_POSSIBLE_PER_PHOTO = int(os.getenv('DAMAGE_MAX_POSSIBLE', '5'))
# Stricter bar for shattered glass: reflections on intact glass are its typical false alarm, and it is a before-driving
# repair. Below the bar it is possible damage instead of a finding. 0.70 measured on the CarDD test set
# (evaluation/results/glass_threshold.md): keeps 96% of real shattered glass as findings, false alarms 12 -> 3 of 16.
STRICT_CONFIDENCE = {'glass_shatter': float(os.getenv('DAMAGE_GLASS_CONFIDENCE', '0.70'))}
MAX_UPLOAD_MB = int(os.getenv('DAMAGE_MAX_UPLOAD_MB', '15'))

# Sound inspection (see sound.py). The audio code is shared with training (acoustic/audio.py) so both prepare
# recordings identically.
ACOUSTIC_DIR = COMPONENT_DIR / 'acoustic'
# Unset: the active version (acoustic/model/active.json, see acoustic/learning.py). Set: always this file.
SOUND_MODEL_PATH = Path(os.environ['SOUND_MODEL_PATH']) if os.getenv('SOUND_MODEL_PATH') else None
# Below this the answer is "not sure, record again": at 0.7 the model answered 93% of test clips, 90.7% of them right
SOUND_SURE_CONFIDENCE = float(os.getenv('SOUND_SURE_CONFIDENCE', '0.7'))
SOUND_MIN_SECONDS = 1.0          # shorter: no prediction at all
SOUND_GOOD_SECONDS = 5.0         # shorter: a warning (fewer windows to vote)
SOUND_CLIPPED_MAX = 0.01         # more than 1% of samples at full scale = the microphone was overloaded
SOUND_QUIET_RMS = 0.003          # quieter than this: probably too far from the engine
MAX_AUDIO_MB = int(os.getenv('SOUND_MAX_UPLOAD_MB', '10'))

# Photo quality limits (see quality.py)
MIN_SIDE_PX = 480
BLUR_MIN = 100.0                 # variance of the Laplacian; lower = blurrier
BRIGHTNESS_RANGE = (40.0, 220.0)  # mean grey level 0-255
