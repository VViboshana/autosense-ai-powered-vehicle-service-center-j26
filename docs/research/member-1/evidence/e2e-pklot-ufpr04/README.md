# End-to-end check: PKLot UFPR04 time-lapse (19 Oct 2026)

What it shows: the whole occupancy pipeline (video -> ROI mask -> YOLO11s + ByteTrack -> bay association -> state
machine), and the whole web app path (browser -> API -> occupancy service -> sync -> PostgreSQL), give bay states
that match the PKLot labels on one test video.

**Video:** `member-1-occupancy/videos/pklot-ufpr04-timelapse.mp4`, 60 PKLot UFPR04 images (21/12/2012, Sunny,
11:30-16:40), each held 6 s; 6 bays (PKLot spaces 6, 13, 15, 22, 24, 27). Truth: the PKLot labels for those spaces
(`pklot-ufpr04-timelapse.truth.json`), 360 bay states.
**Scoring** (`member-1-occupancy/eval/compare_truth.py`): a bay's result for an image is its confirmed state at the end
of that image's 6 s hold; `uncertain` counts as wrong. Default rules (occupied after 3 s, free after 5 s, coverage
threshold 0.4), 2 frames per second, CPU (836 ms per frame for the fine-tuned model on this laptop).

| Run | Model | ROI mask | Path | Bay states matching PKLot |
|---|---|---|---|---|
| `zs_yolo11s_unmasked` | pretrained COCO YOLO11s | off | pipeline | 359 / 360 |
| `ft_yolo11s_masked` | fine-tuned YOLO11s (`best.pt`) | on | pipeline | 360 / 360 |
| `ft_yolo11s_unmasked` | fine-tuned YOLO11s (`best.pt`) | off | pipeline | 155 / 360 (every occupied state read as free) |
| `service_ft_masked` | fine-tuned, video job 2 | on | occupancy service (HTTP) | 360 / 360 |
| `api_db_ft_masked` | fine-tuned, video job 2 | on | browser -> API -> service -> DB (stored bay events) | 360 / 360 |

`best.pt` sha256 `ae7858800bfab8025c6fa622710981779e8cfd14fe66db09bee14ffa08533a49`. Each run's own report is in this
folder (`<run>.md`); the full outputs are in `Datasets/PKLot/e2e/<run>/` on the laptop that ran them.

**How to read it (limitations):**
- One video, one camera, one sunny day, 6 bays. The day (UFPR04/2012-12-21) is in the **test** split
  (`dataset/pklot_splits.json`), so the fine-tuned model never saw these images; but UFPR04 itself is a training
  camera (other days). So this is an integration check, not a measure of accuracy on unseen sites; that is the
  held-out UFPR05 evaluation (`eval_occupancy.py`).
- PKLot is a car park, not a service centre (no real service-centre footage: stated limitation).
- The unmasked fine-tuned run confirms the domain shift that motivated ROI masking (see `member-1-occupancy/README.md`).
- In the service run the bays are named by their database ids (25-30); they were mapped to the PKLot space numbers
  before scoring (`job_pklot_ids.json`).

Reproduce (from `member-1-occupancy/`):
```powershell
.venv\Scripts\python eval\compare_truth.py run --video videos\pklot-ufpr04-timelapse.mp4 --weights model\best.pt --mask on --out <dir>
```
