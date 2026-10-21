# Anomaly Detection

TODO: Add module description, setup instructions, and usage.

## Component 4: vehicle security and disaster detection

The working component is in [`service/`](service/) (full details in [`service/README.md`](service/README.md)).

```
camera / video -> YOLO11m (9 classes) -> ByteTrack (track IDs, dwell time) -> rule engine -> security.alert
                                                                                  ^
                                         Component 1 bay.state (POST /bay-state) -+
```

- Model: `service/models/component4_best.pt` (YOLO11m `c4_v3_yolo11m`), classes in training order:
  `person, vehicle, weapon, fire, smoke, tampering, loitering, face_covered, worker`. Not pushed to git (`.gitignore`).
- Threats: fire, smoke, weapon, vehicle_tampering, unauthorised_access, loitering.
  Severity: low, medium, high, critical.
- All thresholds and rules: `service/configs/threat_rules.yaml`. Alert format, notify groups and the model path:
  `service/configs/integration.yaml`. Camera zones: `service/configs/zones/<camera_id>.yaml`.

### How to run

```bash
cd member-4-anomaly-detection/service
python3.13 -m venv .venv && source .venv/bin/activate     # once
pip install -r requirements.txt pytest                     # once (installs PyTorch through ultralytics)

python -m c4security.infer                                 # model check: class names + one test frame
python -m pytest tests                                     # all tests
python -m c4security --source video.mp4 --zones configs/zones/cam_01.yaml --start-time 21:30   # analyse a video
uvicorn c4security.api:app --port 8004                     # REST service, docs at http://localhost:8004/docs
```

Output of a video run goes to `service/runs/<name>/`: `alerts.jsonl`, `snapshots/`, `annotated.mp4`, `summary.md`.
Keep `runs/` private (people are visible). `c4security.alert_format.to_security_alert()` turns an engine alert into the
AutoSense `security.alert` JSON: `alert_id, threat, severity, affected, notify, reason, confidence, camera_id,
snapshot, timestamp, status`.
