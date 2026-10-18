# Predictive Maintenance

## Predictive Maintenance Inference API

Component 3 exposes a small stateless FastAPI service. The intended architecture is:

`React → shared Express gateway → FastAPI → saved XGBoost pipeline`

The current live ML task is maintenance-category classification. The service does not call the browser, database, other components, or the shared Express backend.

### Models and features

The Basic model uses `Car_Make`, `Car_Model`, `Vehicle_Year`, `Problem Description`, and `Severity` for preliminary intake prediction. The Enriched model adds `Service History`, `ECU Data`, and `Diagnosis`. The saved sklearn pipeline performs its own preprocessing; the API passes the exact feature columns and reuses the supplied LabelEncoder for decoding.

Research metrics currently recorded for the information-source experiment are Basic accuracy 93.25% / macro F1 93.40% and Enriched accuracy 97.40% / macro F1 97.46%. The Random Forest comparison recorded 97.30% / 97.36% versus XGBoost 97.40% / 97.46%, so XGBoost is the selected model.

### Artifacts

Set `AUTOSENSE_MODEL_DIR` to a trusted local directory containing:

```text
maintenance_category_basic_xgboost.pkl
maintenance_category_basic_encoder.pkl
maintenance_category_enriched_xgboost.pkl
maintenance_category_enriched_encoder.pkl
```

The default is `member-3-predictive-maintenance/model/`. Model binaries are ignored by Git. The currently checked-in notebook 03 also produced `maintenance_category_xgboost.pkl` and `maintenance_category_label_encoder.pkl`; these are supported as an enriched-model legacy fallback when the preferred Enriched pair is absent. The local root `models/` directory can therefore be used explicitly with `AUTOSENSE_MODEL_DIR=..\models`.

### Installation and running

From this directory in PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
$env:AUTOSENSE_MODEL_DIR = (Resolve-Path .\model).Path
.\.venv\Scripts\python -m uvicorn backend.maintenance_service.main:app --host 127.0.0.1 --port 8003
```

Swagger: `http://localhost:8003/docs`

Endpoints: `GET /health`, `GET /v1/model`, and `POST /v1/forecast`.

### Example request

```json
{
  "vehicle": {"registration": "CAR-4581", "make": "Toyota", "model": "Corolla", "year": 2018, "mileage": 85240},
  "customerReport": {"problemDescription": "Grinding noise while braking", "severity": "High"},
  "serviceHistory": {"available": true, "summary": "Brake inspection completed during previous service"},
  "diagnostics": {"ecuData": null, "diagnosis": "Front brake pad wear"},
  "inspection": {"linked": true, "inspectionId": "INSP-0142"}
}
```

Meaningful service history, ECU data, or technician diagnosis selects `enriched`; otherwise `basic` is selected. Inspection IDs are reported as a source but are never model features.

The response contains `assessmentType`, `prediction.category`, `prediction.modelScore`, `prediction.categoryScores`, `informationSources`, `maintenanceRequired.status`, `engineCondition.status`, and `duration.status`. The latter statuses are deliberately `not_evaluated`, `not_run`, and `model_pending`; no unsupported predictions are fabricated.

### Limitations

- Maintenance-required and engine-condition models are not integrated into `/v1/forecast`.
- Duration regression is pending.
- FastAPI has no persistence and is a decision-support service, not a replacement for technician judgment.
- Results reflect the current research dataset and are not guaranteed real-world accuracy.
