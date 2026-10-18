# Damage Assessment (component 2)

Finds vehicle damage in a photo with a YOLO11 segmentation model trained on CarDD
(dent, scratch, crack, glass_shatter, lamp_broken, tire_flat). This folder holds the AI service (FastAPI);
the screens and the `inspections` API module live in `shared/`.

```
backend/app/
  main.py              GET /health, POST /predict
  predictor.py         loads a model once; masks -> bbox, polygon, area in image pixels; finds the vehicle
  quality.py           blur / brightness / resolution check before the model
  severity.py          preliminary severity (rule-v0) from damage type + size relative to the vehicle
  severity_rules.json  the thresholds (proposed; to be tuned with the technician)
  config.py            settings (each can be changed with an environment variable)
model/                 best.pt from training goes here (never committed: *.pt is git-ignored)
tests/                 pytest tests for the severity rules
```

## Set up (once)
```powershell
cd member-2-damage-assessment
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
```

## Run
```powershell
cd member-2-damage-assessment\backend
..\.venv\Scripts\python -m uvicorn app.main:app --port 8001
```
Interactive docs: http://localhost:8001/docs. The AutoSense API finds it through `ML_DAMAGE_URL` in `shared/backend/.env`.

Without `model/best.pt` the service uses the COCO model (`yolo11n-seg.pt`, downloaded on first run) and reports
`"placeholder": true`: its labels are COCO objects, not damage, so use it only to test the pipeline.

## API
`POST /predict` (multipart field `image`, optional query `confidence`, default 0.25):
```json
{
  "model": { "version": "expA_yolo11n_640", "placeholder": false },
  "image": { "width": 1280, "height": 960 },
  "quality": { "passed": true, "blurVar": 512.3, "brightness": 121.4, "warnings": [] },
  "vehicle": { "label": "car", "confidence": 0.91, "bbox": [x1, y1, x2, y2], "polygon": [[x, y], ...],
               "areaPx": 573000, "cropped": false },
  "detections": [
    { "label": "dent", "confidence": 0.87, "bbox": [x1, y1, x2, y2], "polygon": [[x, y], ...],
      "areaPx": 18342, "areaRatioImage": 0.0149, "vehicleOverlap": 0.97, "onVehicle": true, "areaRatioVehicle": 0.032, "location": "lower left",
      "severity": "moderate",
      "severityReason": "dent covers 3.2% of the vehicle (under 1% minor, under 5% moderate, else severe)." }
  ],
  "severity": { "overall": "moderate", "method": "rule-v0", "validated": false },
  "processingMs": 340
}
```
Coordinates are pixels of the photo after EXIF rotation. Errors: 400 not an image, 413 larger than 15 MB.

## Severity (rule-v0, preliminary)
The COCO model finds the main vehicle (car, motorcycle, bus or truck: the largest one). Each damage's area is divided
by the vehicle's area (`areaRatioVehicle`), which does not depend on how far away the photo was taken. The rules in
`severity_rules.json` then grade it:

| Damage | Rule |
|---|---|
| scratch | under 3% minor, else moderate |
| dent | under 1% minor, under 5% moderate, else severe |
| crack | under 5% moderate, else severe |
| lamp_broken | always moderate (must be replaced) |
| glass_shatter | always severe (visibility and safety) |
| tire_flat | always severe (not safe to drive) |

Only damage with at least half of its area inside the vehicle's outline (`vehicleOverlap` >= 0.5) is graded. Each
pixel belongs to one visible object, so damage on a car behind the inspected one lies mostly outside its outline:
it gets `onVehicle: false`, no severity, and does not count. Overall severity is the worst graded detection
(`null` when no damage is on the vehicle). Without a vehicle in the photo, all damage counts and size-based classes
are `unavailable`.
`vehicle.cropped` is true when the vehicle touches two or more photo edges, within 1% of the photo size (a close-up): the share is then of the
visible part only. The thresholds are a proposal until checked with the technician (`validated: false`).

## Tests
```powershell
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest
```

| Setting | Default |
|---|---|
| `DAMAGE_MODEL_PATH` | `model/best.pt` |
| `DAMAGE_MODEL_VERSION` | `expA_yolo11n_640` |
| `DAMAGE_IMGSZ` | `640` (must match training) |
| `DAMAGE_CONFIDENCE` | `0.25` |
| `DAMAGE_MAX_UPLOAD_MB` | `15` |
