# Bay Occupancy (component 1)

Detects vehicles with YOLO11, matches them to service-bay polygons and decides whether each bay is occupied, free or
uncertain. This folder holds the AI service and the experiments; the screens and the `occupancy` API module live in
`shared/`.

```
backend/app/
  main.py            GET /health, POST /analyze, POST/GET /video-jobs, POST /video-jobs/{id}/cancel, GET /snapshot
  detector.py        loads YOLO once; vehicle boxes (+ ByteTrack ids for video)
  association.py     vehicle box -> bay score (coverage, IoU, bottom-centre), compared in the evaluation
  state_machine.py   per-bay free/occupied/uncertain with time-based confirmation and score hysteresis
  pipeline.py        video -> sampled frames -> (ROI mask) -> detection -> association -> state machine -> transitions
  roi.py             greys out everything outside the bays before detection, exactly as in training
  jobs.py            runs video jobs one at a time in the background
  config.py          settings (each can be changed with an environment variable)
eval/prepare_pklot.py      PKLot index, day-level split, masked weak labels, gold-set package
eval/eval_occupancy.py     per-space occupancy evaluation (thresholds tuned on val, reported on test/xsite)
eval/compare_truth.py      end-to-end check of the pipeline on a PKLot time-lapse video against its PKLot labels
notebooks/train_vehicle.ipynb  fine-tuning on Kaggle (GPU)
dataset/pklot_splits.json  which camera-day is in which split (seed 0), kept so results can be reproduced
tests/                     pytest
model/                     best.pt from training goes here (never committed: *.pt is git-ignored)
videos/                    recorded videos the service may read (git-ignored)
```

## Run the service
```powershell
cd member-1-occupancy\backend
..\.venv\Scripts\python -m uvicorn app.main:app --port 8002
```
Interactive docs: http://localhost:8002/docs. The AutoSense API finds it through `ML_OCCUPANCY_URL` in
`shared/backend/.env`. Without `model/best.pt` the service uses the COCO model (`yolo11s.pt`) and reports
`"placeholder": true`.

Settings (environment variables): `OCC_MODEL_PATH`, `OCC_MODEL_VERSION`, `OCC_IMGSZ` (1280), `OCC_CONFIDENCE`
(0.25), `OCC_VIDEO_DIR` (videos/), `OCC_ROI_MASK` (auto | on | off), `OCC_ROI_MARGIN_PX` (12), `OCC_PLATES` (auto | on | off), `OCC_MODEL` (auto |
pretrained: force the COCO model, reported as not fine-tuned). Occupancy rules come from the API with each video job (setting
`occupancy.rules`): `overlapThreshold`, `releaseThreshold`, `confirmOccupiedSeconds`, `confirmFreeSeconds`,
`toleranceSeconds`, `minSupport`, `staleAfterSeconds`.

### ROI masking (method decision)
The fine-tuned model was trained on PKLot images greyed out (114) outside the annotated spaces plus a 12 px margin.
On full, unmasked frames it misses most vehicles (domain shift: recall collapses in `ft_yolo11s_1280`), so the service
masks every frame the same way before detection: the union of the job's bay polygons, grown by the margin.

- `OCC_ROI_MASK=auto` (default): on for the fine-tuned model, off for the pretrained COCO model. `on` / `off` force
  it. The pretrained model is left unmasked because masking did not help it and lowered its F1 on PUCPR
  (`zs_yolo11s_1280_masked` against `zs_yolo11s_1280`).
- A request can override it: `"mask": true|false` on `POST /video-jobs`, `?mask=` on `POST /analyze`.
- Margin: 12 px per 1280 px of frame width (0.94 %), at least 4 px (`OCC_ROI_MARGIN_PX`, defined at 1280 px wide), so
  it matches training at any resolution: 12 px at 1280x720, 18 px at 1920x1080.
- `/health` (`model.roiMask`), every video job (`roiMask`) and every `/analyze` result (`roiMask.applied`) say
  whether it was used. Storing it with each video job in the database is planned (migration 0010).
- `tests/test_roi.py` checks the service mask is pixel-identical to `eval/prepare_pklot.py`'s.
- Limitation: a vehicle is only visible inside a bay and its margin, so bays must be drawn generously.
- Possible later work: retrain on a mix of masked and unmasked images so the model does not depend on the mask.

Privacy: masking reduces processing of areas outside the bays before detection. It does not blur number plates or
people inside the bays, and `/snapshot` still returns the full, unmasked frame for drawing bays. The service stores
no frames, only bay states (through the API). NFR-11 (blurring retained footage) is **not met yet**.

### Number-plate reading (identity-aware occupancy)
When a bay is (becoming) occupied, the service reads the parked vehicle's number plate (`plates.py`) so its job can be
linked by identity instead of by queue order.
- Off-the-shelf OCR: RapidOCR (PaddleOCR models, Apache-2.0, `rapidocr-onnxruntime`); nothing trained by us. Setting
  `OCC_PLATES` = auto (on when installed) | on | off; `/health` reports `model.plates`.
- Plates are reduced to their core, the letters and digits (`WP KP-0683` -> `KP0683`); the province code is ignored
  because OCR misreads it most. The same rule is in the API (`occupancy.plates.ts`).
- One reading is never trusted: a plate counts when the same core was read at least 3 times and in 60% of the readings;
  reading stops when settled or after 8 attempts. It is forgotten when the bay turns free.
- The API stores the text (never the image) on `occupancy.bay_status` and the "occupied" event (migration 0013). With
  "Link vehicles by number plate" on (Occupancy settings, default on), the ONE waiting vehicle with that plate is moved
  into the bay ("Linked by number plate" in its history). A plate matching nobody waiting is shown to staff, never
  replaced by a guess; auto-confirm is used only when no plate could be read.
- Feasibility only so far (20/10/2026): one clear front-on photo read correctly down to about 50 px of plate width (a
  digit was wrong at 35 px), and the simulated close-up clip `bay7_plate.mp4` read `WP KP-0683` in 3 of 4 readings.
  Reading accuracy must still be measured on real plate photos. Plates are personal data: only the text is kept.

## In the web app
- **Bay monitor** (`/floor/bays`): live bay states; pick a bay to see its history (state band over the last 100
  changes and a paged list with evidence). Time between two video jobs is shown as "No reading", not as a state.
- **Camera suggestions** on the Bay monitor: when a bay is occupied and no job is in it, the next vehicle in the queue
  (waiting for a bay, then inspected, then checked in; oldest first) is suggested. Staff with `BAY_JOB_CONFIRM` pick
  the vehicle that is really there and confirm; the job moves to `in_bay` (stage history and audit log). Nothing
  moves without that confirmation.
- **Bays & cameras** (`/setup/bays`): cameras, bay outlines, video jobs (with "Bays only (outside masked)").
- **Occupancy settings** (`/setup/occupancy`): the `occupancy.rules` setting and the model the service runs.

## Test data on the shared database
Camera `TEST-PKL04` (the PKLot UFPR04 time-lapse) and its bays `T06`-`T27` are test data, named "[TEST] ...". A camera
whose code starts with `TEST-` is never used for camera suggestions, and its bays cannot be linked to jobs, except
`TEST-SIM` (Hashini's decision, 20/10/2026; see below).
They stay on for the PP1 demo; afterwards switch them off (nothing is deleted, their history is evaluation evidence):
```powershell
node member-1-occupancy/scripts/test_data.mjs status    # or: label | off | on
```

### Simulated service bays (demo only)
`TEST-SIM` ("[TEST] Simulated service bays (AI-generated)", bays `SIM1`-`SIM6`) plays AI-generated service-bay clips
composed by `eval/simulate_bays.py` (each panel stamped "SIMULATED"). **Demo footage only, never evaluation data.**
The fine-tuned model does not detect cars at this closer view (0 % of parked frames in the clip check), so the
service runs the pretrained model for it: start it with `OCC_MODEL=pretrained` (shown as "Not fine-tuned").
Its bays may hold jobs: when a car arrives, the Bay monitor suggests the next waiting vehicle; when a bay with a job
turns free, it asks whether the vehicle left (job -> ready). Staff confirm both.
```powershell
.venv\Scripts\python eval\simulate_bays.py check   --clip <bay1.mp4> --weights model\yolo11s.pt model\best.pt
.venv\Scripts\python eval\simulate_bays.py compose --clips <bay1.mp4> ... <bay6.mp4> --weights model\yolo11s.pt --out videos\sim-service-bays.mp4
node member-1-occupancy/scripts/test_data.mjs sim member-1-occupancy/videos/sim-service-bays.bays.json   # from the repo root
```

## Set up (once)
```powershell
cd member-1-occupancy
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m pytest
```

## Data
The original UFPR PKLot (CC BY 4.0; cite Almeida et al., *Expert Systems with Applications* 42(11), 2015):
https://www.inf.ufpr.br/vri/databases/PKLot.tar.gz (4.6 GB). Datasets stay outside git.

```powershell
$root = "C:\SLIIT\Research Project\Data set\PKLot_original\PKLot\PKLot"
$out  = "C:\SLIIT\Research Project\Data set\PKLot_prepared"
.\.venv\Scripts\python eval\prepare_pklot.py index   --root $root --out $out
.\.venv\Scripts\python eval\prepare_pklot.py split   --out $out
.\.venv\Scripts\python eval\prepare_pklot.py convert --out $out
.\.venv\Scripts\python eval\prepare_pklot.py gold    --out $out
```

Decisions behind the data, and why:

| Decision | Reason |
|---|---|
| Split by camera-day, not by image | Frames five minutes apart are near-duplicates; one day can also appear under two weather folders. |
| UFPR05 never used for training or tuning | It stands in for an unseen site (NFR-06). It is a car park, not a service centre; say so in the report. |
| Images with a space of unknown state are skipped (480 of the train/val images) | That space may hold a car that would be learnt as background. |
| Images greyed out outside the annotated spaces | PKLot labels only some spaces; unlabelled cars would otherwise be learnt as background. |
| Training boxes = bounding rectangle of each occupied space | PKLot has no vehicle boxes. They are loose (slot, not car), so they are for training only. |
| Detection mAP only on the hand-verified gold set (198 images, 22 per camera x condition) | Weak boxes cannot measure detection accuracy. |

Split sizes (images): PUCPR and UFPR04 about 70/15/15 per weather condition; UFPR04 Rainy has only 31 test images,
so its per-condition result is uncertain and should be reported with that caveat.
