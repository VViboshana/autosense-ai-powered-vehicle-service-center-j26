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
(0.25), `OCC_VIDEO_DIR` (videos/), `OCC_ROI_MASK` (auto | on | off), `OCC_ROI_MARGIN_PX` (12). Occupancy rules come from the API with each video job (setting
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
