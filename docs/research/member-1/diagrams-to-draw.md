# Diagrams to draw by hand (Member 1, Harindya N H)

Group rules (`GROUP_CONSISTENCY_GUIDE.md`): **black and white, drawn in draw.io, no AI-generated diagrams**, text inside
figures 12 pt Times New Roman. Each item says what the figure must show; the content comes from the code and the
evidence in this folder, so every box and arrow can be checked against it.

## 1. System architecture (Figure 4.1, shared with the group)
- All four components, left to right 1-4, with the agreed names; **component 1 highlighted** (thick border, light grey
  fill), the others plain boxes labelled with the member number only.
- Same shared data layer, storage and interface layers as the other three reports.
- Agreed dependency arrows: C1 -> C2 (vehicle ID, bay assignment; soft), C2 -> C1 (job completion signal; soft),
  C1 -> C3 (bay/queue state), all -> shared data layer (JSON records; hard).
- Hashini to decide: the agreed name still ends "and Queue ETA Prediction", but ETA is deferred. Agree with the group
  how the figure and text show that.

## 2. Component 1 architecture
Camera / recorded video -> **occupancy service** (FastAPI, port 8002: ROI mask -> YOLO11s detector + ByteTrack ->
bay association -> per-bay state machine) -> **AutoSense API** (Express; pulls job progress every 2 s) ->
**PostgreSQL** `occupancy` schema (+ `app.events` 'bay.state', `app.model_versions`) -> **web screens** (Bay monitor,
Bays & cameras, Occupancy settings, dashboard "Bays now"). Show that the browser never talks to the service directly.

## 3. Frame processing flowchart
Sample frame (2 fps) -> grey out outside the bays (union of bay polygons + margin, 12 px per 1280 px of width) ->
detect vehicles (YOLO11s, imgsz 1280, conf 0.25) -> track ids (ByteTrack) -> score each bay (coverage) -> state
machine -> transition? -> report. Mark the masking step as the method decision.

## 4. Bay state machine
States free / occupied / uncertain. Occupied after coverage >= 0.4 for 3 s; free after coverage < release threshold
(0.3) for 5 s; contrary blips up to 1 s ignored; at least 80 % of samples must agree; no observation for 10 s ->
uncertain. (Values are the `occupancy.rules` setting; label them as defaults.)

## 5. ROI masking illustration
Three panels from one real PKLot frame: original, bay polygons drawn, masked frame (grey outside). This can be a real
processed image (not a drawn diagram); say in the caption that it is produced by `roi.py`.

## 6. Sequence: processing a camera's video
Staff (Bays & cameras) -> API `POST /video-jobs` -> service `POST /video-jobs` (bays, rules) -> service processes ->
API sync loop `GET /video-jobs/{id}?since=n` every 2 s -> DB (bay_state_events, bay_status, app.events) -> screens refresh.

## 7. Sequence: camera suggestion, staff confirm
Bay turns occupied -> Bay monitor shows "Suggested by the camera" with the next vehicle in the queue -> staff pick the
vehicle -> `POST /occupancy/bay-suggestions/confirm` -> job stage `in_bay` (+ stage history, audit log). Show that
nothing moves without staff confirmation.

## 8. Data preparation and split
PKLot (UFPR, CC BY 4.0) -> index -> **split by camera-day** (PUCPR, UFPR04 ~70/15/15; UFPR05 held out as unseen site) ->
masked training images + weak boxes from occupied spaces -> fine-tuning (Kaggle T4) ; 198-image gold set for detection
mAP (hand-verified in CVAT).

## 9. Evaluation design
Pretrained COCO YOLO11s vs fine-tuned YOLO11s; masked vs unmasked input; thresholds tuned on val, reported on test and
on UFPR05 (xsite), per weather condition; end-to-end time-lapse check (evidence/e2e-pklot-ufpr04).

## 10. Database (occupancy schema)
`occupancy.cameras` 1-* `occupancy.bays` 1-1 `occupancy.bay_status`; bays 1-* `bay_state_events` *-1 `video_jobs`
*-1 `app.model_versions`; `workshop.jobs.bay_id` -> bays (job in bay). Include `video_jobs.roi_mask` (migration 0010).
