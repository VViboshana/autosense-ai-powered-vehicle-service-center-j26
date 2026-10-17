# Damage Assessment (component 2)

Finds vehicle damage in a photo with a YOLO11 segmentation model trained on CarDD
(dent, scratch, crack, glass_shatter, lamp_broken, tire_flat). This folder holds the AI service (FastAPI);
the screens and the `inspections` API module live in `shared/`.

```
backend/app/
  main.py        GET /health, POST /predict
  predictor.py   loads the model once; masks -> bbox, polygon, area in image pixels
  quality.py     blur / brightness / resolution check before the model
  config.py      settings (each can be changed with an environment variable)
model/           best.pt from training goes here (never committed: *.pt is git-ignored)
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
  "detections": [
    { "label": "dent", "confidence": 0.87, "bbox": [x1, y1, x2, y2], "polygon": [[x, y], ...],
      "areaPx": 18342, "areaRatioImage": 0.0149 }
  ],
  "processingMs": 340
}
```
Coordinates are pixels of the photo after EXIF rotation. Errors: 400 not an image, 413 larger than 15 MB.

| Setting | Default |
|---|---|
| `DAMAGE_MODEL_PATH` | `model/best.pt` |
| `DAMAGE_MODEL_VERSION` | `expA_yolo11n_640` |
| `DAMAGE_IMGSZ` | `640` (must match training) |
| `DAMAGE_CONFIDENCE` | `0.25` |
| `DAMAGE_MAX_UPLOAD_MB` | `15` |
