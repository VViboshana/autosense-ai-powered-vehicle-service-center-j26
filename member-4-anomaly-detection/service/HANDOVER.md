# Component 4 (security) — handover for the PP1 demo laptop

For: Manodya (Windows 11, PowerShell). From: Viboshana (member 4).
Goal: the security service runs on port 8004, the Safety screens work, and a demo video produces real alerts.

## 1. What is in `component4-handover.zip`

| Path in the zip | What it is |
|---|---|
| `service/models/component4_best.pt` | The trained model (YOLO11m `c4_v3_yolo11m`, 9 classes, 40.5 MB). Not in git (team rule). |
| `demo_videos/fire_workshop_floor.mp4` | 10 s, 1280×720. Fire starts on a workshop floor. |
| `demo_videos/smoke_parts_store.mp4` | 10 s, 1280×720. Smoke spreads in a parts store. |
| `demo_videos/tampering_parked_cars.mp4` | 10 s, 1280×720. A person tampers with parked cars. |
| `HANDOVER.md` | This file (the same file is in git at `member-4-anomaly-detection/service/HANDOVER.md`). |

**Where the videos come from:** all three are AI-generated with a Google video tool (they carry Google C2PA content
credentials). Nobody in them is a real person. Fine to show in the demo and the video.

Nothing else is needed outside git. Zone files (`configs/zones/`), rules (`configs/threat_rules.yaml`,
`configs/integration.yaml`) and the tracker config (`bytetrack.yaml`, ships with the `ultralytics` package) are already in
the repo. No passwords or connection strings are in the zip: use the team's own `shared/backend/.env.local` as usual.

## 2. One-time setup (PowerShell)

Needs **Python 3.13** (3.10–3.13 work; 3.14 is not tested). Check with `py -3.13 --version`; if it is missing, install
it from python.org (tick "Add python.exe to PATH").

```powershell
cd <repo>\member-4-anomaly-detection\service
# Copy the model in from the unzipped package (creates models\component4_best.pt):
Copy-Item -Recurse <unzipped>\service\models .\models
py -3.13 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r requirements.txt pytest
.venv\Scripts\python -m pytest -q tests          # expect: 14 passed
```

- `pip install` pulls in **PyTorch** (through `ultralytics`), a download of several hundred MB, so it takes a while.
  The normal Windows build from pip is **CPU-only. That is fine**: no CUDA or GPU needed. (With an NVIDIA GPU you could
  install the CUDA build of PyTorch from pytorch.org first, but it is not needed for the demo.)
- After setup the service runs offline: nothing is downloaded at run time.

## 3. Start the service (keep this window open)

```powershell
cd <repo>\member-4-anomaly-detection\service
.venv\Scripts\uvicorn c4security.service:app --host 127.0.0.1 --port 8004
```

Or run `powershell -ExecutionPolicy Bypass -File .\start.ps1`, which does the same and checks the model is there.

Use **`c4security.service:app`**, not `c4security.api:app`. The web app needs `service:app`: it has the browser-playable
video and the delete endpoints on top of the API.

Check: open http://localhost:8004/health. It must show
`"status":"ok"` and **`"model_found":true`** (`false` means `models\component4_best.pt` is not in the right place).
http://localhost:8004/docs shows the API.

## 4. Web app settings

- `ML_SECURITY_URL=http://localhost:8004` is already in `shared/backend/.env` (committed) and is read by
  `config/env.ts` like the other AI services. Nothing to add. It defaults to the same address if missing.
- Videos and snapshots the web app keeps go to `UPLOAD_DIR` (default `shared/backend/uploads/`), under
  `uploads\security\videos\<id>\`. The service keeps its own working copies in
  `member-4-anomaly-detection\service\runs\`. Both folders are created automatically and are git-ignored. Nothing to
  create by hand.

## 5. Database

Component 4 uses migrations `0005_maintenance_security.sql`, `0007_security.sql`, `0010_security_videos.sql`,
`0011_security_synthetic.sql`, `0012_security_camera_status.sql`, reference data `reference/050_security.sql` and the
sample cameras in `seeds/140_security_demo.sql`.

On the shared database **all of them are already applied** (checked with `npm run db:status` on 22 Oct 2026). So nothing
needs to be done. Running `npm run db:status` in `shared\` should list every file as `applied`. If one says pending,
run `npm run db:migrate`.

Careful with the shared database:
- `npm run db:seed` is safe for alerts made by the model. It only re-adds missing sample cameras and removes old
  hand-made `SEC-DEMO-*` alerts.
- **`npm run db:reset` deletes everything**, including every alert and video analysis the model made. Do not run it
  before the demo.

## 6. End-to-end test in the browser

1. Start the security service (section 3) and the web app (`npm run dev` in `shared\`). Sign in as a staff user who
   can see **Safety**.
2. **Safety › Cameras**. The top of the page should not say "Security service not running" or "Model file missing".
3. Click **Analyse a recording**. Pick a camera, choose a demo video, tick **Short clip: shorter rule times**, and
   start it.
4. Wait. It says *Analysing*, then shows the analysis summary, the annotated video and *Alerts in this video*.
5. Open **Safety › Alerts**. The new alerts are at the top with severity, snapshot and who is notified.

| Video | Use camera | Expected alerts (measured on CPU, short-clip timings) |
|---|---|---|
| `fire_workshop_floor.mp4` | SEC-03 Workshop floor | **fire, Critical** at ~0:05 (notify: security guard, centre manager, fire service, vehicle owner, bay supervisor; emergency call after staff confirm). It also raises tampering High/Critical at ~0:06 (a false positive: a person near the car). |
| `smoke_parts_store.mp4` | SEC-04 Parts store | **smoke, High** at ~0:04 (security guard, centre manager, fire service, vehicle owner, bay supervisor) |
| `tampering_parked_cars.mp4` | SEC-02 Car park | **tampering, High** at ~0:03, then **Critical** at ~0:07 (security guard, bay supervisor, vehicle owner, centre manager; emergency call after staff confirm) |

How long it takes: each 10 s clip took about 18 s on an Apple M-series CPU with the GPU switched off. Expect about
**30 s to 2 min** on a Windows laptop CPU. The first run is a few seconds slower (the model loads).

Note: **Model demo** (synthetic test video) also works with these clips, but its alerts are marked synthetic and are
**kept out of Safety › Alerts** on purpose. To show alerts in the Alerts list, use a camera (step 3).

## 7. Known limitations

- CPU only on most laptops. Long or 4K videos are slow; use short 720p clips for the demo.
- The browser-playable video is converted to H.264 after the analysis. On Windows the service uses Windows' own
  Media Foundation encoder for this. **This was not tested on Windows.** If it fails, the alerts and snapshots still
  appear; only the annotated video shows "No annotated video stored".
- The fire clip also raises a tampering alert (a visitor standing near a car). The rules are tuned for recall.
- Loitering needs a person to stay 20 s (short-clip timing) or 120 s (standard) near a car, so the 10 s clips do not
  show it.
- Running jobs are kept in memory: if the service is restarted during an analysis, that analysis is lost (start it
  again).
- `runs\` holds video of people. Keep it private; it is git-ignored.
