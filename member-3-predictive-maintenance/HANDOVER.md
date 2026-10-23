# Component 3 Handover â€” Predictive Maintenance & Service Duration

For: **Manodya** â€” running the whole AutoSense system on one Windows 11 laptop (PowerShell) for the PP1 demo.

- Repository: `https://github.com/VViboshana/autosense-ai-powered-vehicle-service-center-j26.git`
- Branch: `member-3-maintenance-prediction` (PR target: `development`)
- Architecture (do not change): **React (:5173) â†’ Express (:5000) â†’ Component 3 FastAPI (:8003) â†’ trained model artifacts**

## 1. Why a ZIP is needed

Trained model files (`*.pkl`) are **intentionally git-ignored**. A fresh `git pull` is missing three of them, and without them FastAPI `/health` is `degraded` and the web UI shows *"Maintenance prediction service is currently unavailable."*

Missing after a fresh pull (all inside `component3-handover.zip`):

- `maintenance_category_enriched_preprocessor.pkl`
- `service_duration_random_forest_final.pkl`
- `service_duration_random_forest_task_only_fallback.pkl`

The ZIP also contains the four already-tracked runtime files, so extracting it always yields the complete set (it overwrites them with identical copies).

## 2. Copy the model artifacts

`component3-handover.zip` contains a `model\` folder. Extract it so its files land in **`member-3-predictive-maintenance\model\`**. From the repository root:

```powershell
Expand-Archive -Path "$HOME\Downloads\component3-handover.zip" -DestinationPath "$env:TEMP\c3" -Force
Copy-Item "$env:TEMP\c3\model\*" ".\member-3-predictive-maintenance\model\" -Force
```

(Adjust the ZIP path to wherever you saved it.) The `model\` folder must then contain exactly these runtime files (plus tracked extras like `.gitkeep`):

| File | Purpose |
|---|---|
| `maintenance_category_enriched_xgboost.json` | Active category classifier (XGBoost, native JSON) |
| `maintenance_category_enriched_preprocessor.pkl` | Fitted sklearn preprocessor (must produce 169 features) |
| `maintenance_category_label_encoder.pkl` | Decodes class index â†’ category name |
| `service_duration_random_forest_final.pkl` | Primary duration model (`task_plus_cost`) |
| `service_duration_random_forest_task_only_fallback.pkl` | Fallback duration model (`task_only`) |
| `service_duration_model_metadata.json` | Duration model metadata/metrics |
| `maintenance_task_catalog_app.csv` | Candidate repair-task catalogue |

Active pipeline: raw enriched fields â†’ preprocessor â†’ 169 features â†’ XGBoost â†’ label encoder.

Do **not** commit the `.pkl` files (`.gitignore` blocks them; do not `git add -f`).

## 3. Python environment

Required: **Python 3.12** (verified with 3.12.0). `scikit-learn` and `xgboost` versions are pinned in `requirements.txt` and **must not be changed** â€” they must match the versions the artifacts were created with.

```powershell
cd member-3-predictive-maintenance
py -3.12 -m venv .venv312
.\.venv312\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

If script execution is blocked: `Set-ExecutionPolicy -Scope Process Bypass` and activate again.

Pinned: fastapi 0.153.0, uvicorn 0.54.0, pydantic 2.14.1, pandas 3.0.6, numpy 2.5.4, scipy 1.18.1, joblib 1.6.0, scikit-learn 1.6.1, xgboost 3.4.1.

## 4. Start FastAPI (port 8003)

`AUTOSENSE_MODEL_DIR` is the folder holding the artifacts. If unset it defaults to `member-3-predictive-maintenance\model`, so setting it is optional but recommended:

```powershell
# from member-3-predictive-maintenance
$env:AUTOSENSE_MODEL_DIR = (Resolve-Path ".\model").Path
.\.venv312\Scripts\python.exe -m uvicorn backend.maintenance_service.main:app --host 127.0.0.1 --port 8003
```

**Leave this terminal open for the whole demo.** Open new terminals for everything else.

Verify (new terminal):

```powershell
Test-NetConnection 127.0.0.1 -Port 8003          # TcpTestSucceeded : True
Invoke-RestMethod http://127.0.0.1:8003/health | ConvertTo-Json -Depth 5
```

Healthy response:

```json
{
  "status": "ok",
  "service": "maintenance-prediction",
  "modelsLoaded": true,
  "categoryModel": "ready",
  "durationPrimaryModel": "ready",
  "durationFallbackModel": "ready",
  "taskCatalogue": "ready"
}
```

If any value is `unavailable`/`degraded`, an artifact is missing or unloadable â€” recheck section 2 and 3.

**Known non-blocking warning:** the FastAPI log prints `Basic predictive maintenance model unavailable: missing artifacts: maintenance_category_basic_encoder.pkl`. The basic model is not part of the active enriched workflow and `/health` stays `ok`. Practical consequence: the service picks the *enriched* model only when service history, ECU data or a technician diagnosis is supplied. A forecast with **only** problem description + severity selects the basic model and returns an error ("selected prediction model is unavailable"). **For the demo, always supply service history and/or a Diagnosis in Step 3 (or use a vehicle that has service history).**

## 5. Express backend (port 5000) and frontend (5173)

`shared\backend\.env` (committed, contains no secrets) must contain:

```
MAINTENANCE_ML_SERVICE_URL=http://127.0.0.1:8003
```

It already does. If you change any environment variable, **restart Express**. The database URL (`DATABASE_URL`) belongs in your own `shared\backend\.env.local` (never committed, never shared in the ZIP).

Startup order for the full system:

1. Component 3 FastAPI â€” `:8003` (section 4)
2. Express â€” `:5000`: `cd shared\backend; npm install; npm run dev`
3. Frontend â€” `:5173`: `cd shared\frontend; npm install; npm run dev`

(Other components' FastAPI services start per their own docs.) React talks **only to Express** (`/api` is proxied to `:5000`); it must never call port 8003 directly. Express calls FastAPI at `MAINTENANCE_ML_SERVICE_URL`.

## 6. Database

Component 3 needs migration **`shared/database/migrations/0010_maintenance_forecasts.sql`** (creates `maintenance.forecasts`). It is **already applied on the current shared database**. If you use a **fresh database**, apply everything with:

```powershell
cd shared\backend
npm run db:migrate    # applies migrations 0001..0010 and the reference data in shared/database/reference
npm run db:seed       # optional demo data (bays/cameras only - it does NOT create vehicles or bookings)
```

Code-verified dependencies:

- Tables read: `workshop.vehicles`, `workshop.customers`, `workshop.bookings`, `workshop.service_types`, `workshop.jobs`, `damage.inspections`, `app.users`.
- A forecast **links existing** customer, vehicle, booking and inspection rows (foreign keys); it never creates duplicate vehicle/customer records.
- Reference data: `040_service_types.sql` (booking service types) is used when listing bookings. No Component 3-specific seed file exists; the seeds do not create vehicles/customers/bookings, so the database needs existing vehicle and booking rows (created through the app, or already present in the shared database) before there is anything to forecast.

## 7. Browser end-to-end test

Sign in, then:

1. **Maintenance â†’ Forecasts â†’ Bookings awaiting forecast** â†’ *Create forecast* on a row (or *New forecast* and pick a vehicle).
2. **Step 1 Vehicle** (includes the *Vehicle & customer report* card) - verify registration/make/model/year/mileage (year must be recorded; mileage required), then enter the problem description and perceived severity.
3. **Step 2 Service history** - check/edit the service history summary (pre-filled from the vehicle's jobs).
4. **Step 3 Diagnostics & inspection** - enter a *Technician diagnosis* and/or ECU code (see the note in section 4); optionally an inspection ID.
5. **Step 4 Review** -> **Run forecast** (overall flow: Vehicle -> Service history -> Diagnostics -> Review).
6. **Result page** should show: a predicted category, a model score, a list of candidate repair tasks, `maintenanceRequired = not_evaluated`, and duration "awaiting technician task selection". The category depends on the input â€” do not expect a specific one.
7. **Select a candidate repair task in the *Task selection* card and estimate its duration**: returns estimated hours/minutes, the model variant (task_plus_cost or task_only_fallback) and a benchmark note.
8. **Confirm forecast** â€” persists it (status `confirmed`) in `maintenance.forecasts`; it appears in the Forecasts list.

**Booking duration vs Component 3 duration:** the customer booking duration is a planning/catalogue duration for the service type. Component 3 duration is a post-diagnosis, specific-task *estimated labor* duration. They are different and not meant to match.

**Regression check for the form-overwrite fix (manual â€” the frontend has no test framework):** open *Create forecast* from a booking, immediately type a mileage (e.g. `120000`) before the vehicle details finish loading (throttle the network to "Slow 3G" in DevTools to make this easy), wait for registration/make/model to fill in. Mileage must remain `120000`, and *Run forecast* must not bounce you back to Step 1 with "Enter a valid mileage".

## 8. Known limitations

- The model score is decision-support information, not proof that the diagnosis is correct. Technician confirmation is mandatory.
- Broad category prediction and the specific repair task are separate steps; the technician chooses the task.
- The candidate-task bridge (category â†’ catalogue tasks ranked by `probability_rank`) is not a supervised mapping with measured accuracy.
- Duration target is *estimated labor hours* from MechanicDB benchmark data (`estimated_labor_hours`), not observed workshop time or customer waiting time. Primary CV MAE â‰ˆ 14.0 min, RÂ² â‰ˆ 0.64 (fallback MAE â‰ˆ 17.2 min, RÂ² â‰ˆ 0.55).
- `maintenanceRequired` is always `not_evaluated`; the engine-condition model is not integrated (`not_run`).
- The optional basic category model is unavailable (missing encoder) â€” see section 4.
- The standalone **Service history** page (`/maintenance/history`) is not backed by data yet and shows an empty list. Service history used in forecasts comes from the shared database (jobs) via the vehicle bootstrap.
- Model outputs reflect the research dataset and are not guaranteed real-world accuracy.

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| UI: "Maintenance prediction service is currently unavailable." | FastAPI not running, wrong port, or artifacts missing. Check `/health`. |
| `/health` degraded | A file from section 2 is missing/unloadable; confirm Python 3.12 and pinned packages. |
| Express can't reach FastAPI | Confirm `MAINTENANCE_ML_SERVICE_URL=http://127.0.0.1:8003` and restart Express. |
| "selected prediction model is unavailable" on forecast | Basic model path was chosen; add service history / diagnosis (section 4). |
