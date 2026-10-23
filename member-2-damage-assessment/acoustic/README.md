# Sound inspection (component 2, PP2)

Recognises vehicle faults from a short sound recording. The technician picks the situation, records 5-10 s, and the
model chooses between that situation's classes:

| Situation | Classes |
|---|---|
| starting | normal_start, bad_ignition, dead_battery |
| idling | normal_idle, low_oil, power_steering, serpentine_belt, misfire, tappet |
| braking | normal_brakes, worn_brakes |

How a recording is judged: mono 32 kHz, cut off above 11 kHz (some sources were recorded at 24 kHz; this stops the
model from using "no high sound" as a clue), scaled to the same loudness, cut into 1.5 s windows (half overlapping).
Each window gets class probabilities; the windows' average is the answer.

Results: [results/results.md](results/results.md).

## Data (not in git)
Kept outside the repository, like CarDD. One folder (`--data` or `ACOUSTIC_DATA_DIR`) holding:

| Folder | Source | Used for |
|---|---|---|
| `Car Diagnostics Dataset` | Kaggle `malakragaie/car-diagnostics-dataset` | training + testing (9 classes) |
| `Sri Lanka Engine Sounds (HF)` | Hugging Face `RashmiKarunarathne/MyDataSet` (phone recordings of Sri Lankan cars) | training + testing (normal idle, misfire, tappet, belt) |
| `ai mechanic - engine condition audio fault finding` | Kaggle `eoinedge/ai-mechanic-engine-condition-audio-fault-finding` | extra test only (another source) |

`prepare.py` cleans them and records every file's fate in [data/manifest.csv](data/manifest.csv): synthetic mixes
(Car Diagnostics "combined" folder), silent files, exact duplicates and files saved under two labels are rejected.
Near-identical clips (probably pieces of one recording) share a `group` and are never split between training and testing.

## Run
From this folder, with the component's `.venv`:
```powershell
..\.venv\Scripts\python -m pip install -r requirements.txt
..\.venv\Scripts\python download_panns.py                      # once: PANNs CNN14 weights (~330 MB) to ~/panns_data
$env:ACOUSTIC_DATA_DIR = "C:\Manodya\Research\Datasets\Vehicle Sound Inspection"
..\.venv\Scripts\python prepare.py                             # ~1 min  -> data/manifest.csv
..\.venv\Scripts\python features.py                            # ~8 min  -> cache/features.npz
..\.venv\Scripts\python features.py --noisy-copies 2           # ~16 min -> cache/features_noisy.npz
..\.venv\Scripts\python train.py                               # compare models -> results/, model/sound_classifier.joblib
```

## Files
```
classes.py          classes, situations, label mapping per source dataset
audio.py            loading, band limit, loudness, windows, workshop-like noise
prepare.py          cleaning + twin groups -> data/manifest.csv
features.py         MFCC (classic) and PANNs (pre-trained) features per window -> cache/
train.py            grouped cross-validation of all models, choice rule, final model -> results/, model/
download_panns.py   fetches the PANNs files (panns_inference would use wget, which Windows lacks)
```
