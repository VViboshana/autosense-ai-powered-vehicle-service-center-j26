# AutoSense Component 4 — Vehicle Security & Disaster Detection

Protects each customer's parked vehicle in the service centre. It turns camera video into `security.alert` events.

```
camera / video ─► YOLO11m (9 classes) ─► ByteTrack (IDs) ─► rule engine ─► security.alert ─► webhook / JSONL / REST
                                                               ▲
                                    Component 1 bay.state ─────┘ (which job / plate is in which bay)
```

| Threat | Detected by | Base severity |
|---|---|---|
| fire | model class `fire` | Critical |
| smoke | model class `smoke` (raised: on a vehicle, > 10 s) | High |
| weapon | model class `weapon` | Critical |
| tampering | model class `tampering`, or a visitor touching a vehicle ≥ 10 s | High |
| unauthorised_access | a visitor inside a restricted zone, no worker near | Medium |
| loitering | model class `loitering`, or a visitor near a vehicle ≥ 120 s | Low |

Severity rises by one level for: face covered, after hours (19:00–07:00), near a vehicle, or a group of 2+.
Workers (a coverall / hi-vis `worker` box on the person) never trigger tampering, loitering or access alerts.
All numbers are in `configs/threat_rules.yaml`. You can change them there without retraining.

## Folder

```
c4security/   engine.py (rules)  pipeline.py (detect + track + run)  api.py (REST)  cli.py  publisher.py  zone_helper.py
configs/      threat_rules.yaml   zones/<camera_id>.yaml
models/       component4_best.pt  (trained YOLO11m, 9 classes, 40 MB; not in git: get it from component4-handover.zip)
tests/        python -m pytest tests
Dockerfile    requirements.txt
```

## Setup (once)

Python 3.10–3.13:

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt                        # installs PyTorch through ultralytics
python -m pytest tests                                 # optional check (pip install pytest); expect 8 passed
```

For an NVIDIA GPU, first install the CUDA build of PyTorch from pytorch.org, then run the line above.
On a Mac with Apple silicon, `mps` is used automatically.

Docker (CPU): `docker build -t c4-security . && docker run -p 8004:8004 -e C4_WEBHOOK_URL=http://backend:8000/events c4-security`

## Run as a service (integration)

For the AutoSense web app, use `c4security.service:app` (the API below plus the browser video and delete
endpoints the Cameras screen needs). `./start.sh` (macOS/Linux) or `.\start.ps1` (Windows) runs exactly this:

```bash
uvicorn c4security.service:app --host 127.0.0.1 --port 8004
```

`c4security.api:app` is the plain REST API without those two endpoints. Open http://localhost:8004/docs for the interactive API.

| Method | Path | Use |
|---|---|---|
| GET | `/health` | status, model found, running jobs |
| POST | `/analyze` | upload a recorded video (form: `video`, `camera_id`, optional `start_time` HH:MM, `overrides`) → `job_id` |
| POST | `/streams` | `{"source": "rtsp://...", "camera_id": "cam_01"}` start watching a live camera → `job_id` |
| DELETE | `/streams/{job_id}` | stop a live camera |
| GET | `/jobs`, `/jobs/{job_id}` | status and summary (alerts per threat, people tracked, workers) |
| GET | `/jobs/{job_id}/files/{name}` | `annotated.mp4`, `summary.md`, `alerts.jsonl`, `snapshots/001_fire.jpg` |
| GET | `/alerts?camera_id=&severity=&job_id=&limit=` | latest alerts, newest first |
| POST | `/bay-state` | Component 1 event (below) |

Environment variables (all optional):

| Variable | Default | Meaning |
|---|---|---|
| `C4_WEBHOOK_URL` | none | every alert is also POSTed (JSON) here, e.g. the backend's event endpoint / bus bridge |
| `C4_DATA_DIR` | `runs/` | uploads, outputs, `alerts.jsonl` per job |
| `C4_ZONES_DIR` | `configs/zones` | zone file `<camera_id>.yaml` per camera |
| `C4_MODEL` / `C4_RULES` | bundled files | other weights / rules |
| `C4_DEVICE` | auto | `cpu`, `mps`, `0` (GPU) |

### Input from Component 1 — `bay.state`

```json
POST /bay-state
{"camera_id": "cam_01", "zone": "work_bay_1", "status": "occupied", "job_id": "JOB-0042", "plate": "WP-CAR-7788"}
```

`status: "free"` removes the link. `zone` must be a `restricted` zone name in that camera's zone file.
Running cameras pick up the change at once.

### Output — `security.alert` (webhook body, `/alerts`, `alerts.jsonl`)

```json
{"event": "security.alert", "alert_id": "3f9c1a2b7d4e", "threat_type": "tampering", "severity": "Critical",
 "escalated_from": null, "confidence": 0.56, "camera_id": "cam_01", "zone": "work_bay_1",
 "source": "rtsp://...", "video_time_s": 41.5, "clock_time": "2026-10-21T21:30:41",
 "person_track_id": 7, "person_role": "visitor",
 "affected_vehicles": [{"vehicle_track_id": 3, "zone": "work_bay_1", "job_id": "JOB-0042", "plate": "WP-CAR-7788"}],
 "affected_persons": 1, "reasons": ["after hours"],
 "notify_roles": ["security_guard", "bay_supervisor", "vehicle_owner", "centre_manager", "emergency_call_after_staff_confirm"],
 "status": "open", "snapshot": "snapshots/001_tampering.jpg", "processed_at": "2026-10-21T21:30:42"}
```

- `threat_type`: `fire | smoke | weapon | tampering | unauthorised_access | loitering`.
- `severity`: `Low | Medium | High | Critical`.
- `escalated_from` is set when the same threat comes back at a higher severity within the 30 s cooldown.
- Fetch the evidence image with `GET /jobs/{job_id}/files/{snapshot}`. Alerts from `/alerts` also carry `job_id`.

## Run without the service (CLI)

```bash
python -m c4security --source video.mp4 --zones configs/zones/cam_01.yaml --start-time 21:30
python -m c4security --source rtsp://user:pass@192.168.1.10:554/stream1 --zones configs/zones/cam_01.yaml
python -m c4security --source 0                                       # webcam
```

Useful options:
- `--set loitering.dwell_s=20 --set tampering.touch_s=3` for short demo clips.
- `--no-video` for speed.
- `--webhook URL`.

Output goes to `runs/<name>/`: `alerts.jsonl`, `snapshots/`, `annotated.mp4`, `summary.md`.

## Add a camera

1. Run `python -m c4security.zone_helper --source <video or rtsp url>`. It writes a frame with a 0.1 grid to `runs/zone_helper/`.
2. Copy `configs/zones/cam_01.yaml` to `configs/zones/<camera_id>.yaml`. Write the restricted (work bay, parts store)
   and public (waiting area) zone corners as fractions 0–1.
3. Check the zones: run the helper again with `--zones configs/zones/<camera_id>.yaml`.

## Notes

- Free and offline. No data leaves the machine except alerts sent to your own `C4_WEBHOOK_URL`.
  Video and snapshots show people, so keep `runs/` private.
- Speed: about 3× real time on an Apple M-series GPU with `frame_step: 2`. It is slower on CPU; raise
  `detection.frame_step` to 3–4 there.
- Model version: trained YOLO11m `c4_v3_yolo11m`. Classes: `person, vehicle, weapon, fire, smoke, tampering, loitering, face_covered, worker`.
