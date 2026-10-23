r"""Retrains the sound model with the recordings technicians confirmed in the app. Started by the damage service
(POST /sound/retrain) as a separate low-priority process; it writes its progress to <run>/status.json, which the
service reads back for the app's live view:

  collect -> fingerprint (new recordings only; the datasets come from cache/) -> compare (fair test, current vs new)
  -> train (final model + odd-sound check) -> done | failed

The new version is saved in model/versions/<n>/ but NOT activated: someone with the right to do so decides.

  ..\.venv\Scripts\python retrain.py --run model\runs\<id>     a run prepared by the service (request.json + recordings)
  ..\.venv\Scripts\python retrain.py --init                    version 1 from the datasets alone, made active
"""
import argparse
import csv
import json
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np

import learning

HERE = Path(__file__).resolve().parent
STAGES = ['collect', 'fingerprint', 'compare', 'train']


class Status:
    def __init__(self, folder: Path):
        self.path = folder / 'status.json'
        self.data = {'state': 'running', 'stage': 'collect', 'progress': 0.0, 'message': 'Starting', 'stages': {},
                     'startedAt': _now(), 'finishedAt': None, 'result': None, 'error': None}
        self.started = time.monotonic()
        self.save()

    def stage(self, name: str, message: str, progress: float = 0.0):
        self.data['stages'].setdefault(name, {'startedAt': _now()})
        self.data.update(stage=name, message=message, progress=round(progress, 3))
        self.save()

    def done_stage(self, name: str):
        self.data['stages'].setdefault(name, {})['seconds'] = round(time.monotonic() - self.started, 1)

    def save(self):
        tmp = self.path.with_suffix('.tmp')
        tmp.write_text(json.dumps(self.data, indent=2), encoding='utf-8')
        tmp.replace(self.path)  # the service never reads a half-written file


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def load_datasets() -> learning.Data:
    with (HERE / 'data' / 'manifest.csv').open(encoding='utf-8') as f:
        rows = {r['path']: r for r in csv.DictReader(f) if r['use'] == 'yes'}
    clean, noisy = np.load(HERE / 'cache' / 'features.npz'), np.load(HERE / 'cache' / 'features_noisy.npz')
    if any(k not in npz.files for npz in (clean, noisy) for k in ('vehicle', 'other')):
        raise RuntimeError('The features cache is from an older version: run features.py (with and without --noisy-copies 2).')
    return learning.dataset_data(rows, clean, noisy)


def build(d: learning.Data, status: Status | None, version: int) -> tuple[dict, dict]:
    """Compare, then train the final model on everything; returns (bundle, report)."""
    if status:
        status.stage('compare', 'Fair test: current vs new on the same 5 folds', 0)
    comparison = learning.compare(d, lambda k, n: status and status.stage('compare', f'Fair test: fold {k} of {n}', k / n))
    if status:
        status.done_stage('compare')
        status.stage('train', 'Training the new model on everything', 0)
    model = learning.fit(d, np.arange(d.clips))
    fam = learning.fit_familiarity(d)
    trained = datetime.now().strftime('%Y-%m-%d %H:%M')
    on = learning.trained_on(d)
    b = learning.bundle(model, fam, version, trained, on)
    report = {'versionNo': version, 'version': b['version'], 'recipe': learning.RECIPE, 'trained': trained,
              'trainedOn': on, 'appRecordings': on.get('app', 0), 'comparison': comparison,
              'familiarity': {'marginThreshold': round(fam.margin_threshold, 3), 'distanceThreshold': round(fam.distance_threshold, 2)}}
    return b, report


def save_version(b: dict, report: dict):
    folder = learning.VERSIONS_DIR / str(report['versionNo'])
    folder.mkdir(parents=True, exist_ok=True)
    joblib.dump(b, folder / 'sound_classifier.joblib')
    (folder / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


def run(folder: Path):
    status = Status(folder)
    try:
        request = json.loads((folder / 'request.json').read_text(encoding='utf-8'))
        status.stage('collect', 'Loading the datasets and your recordings')
        base = load_datasets()
        recordings = [{**r, 'path': str(folder / r['file'])} for r in request['recordings']]
        status.done_stage('collect')

        status.stage('fingerprint', f'Fingerprinting {len(recordings)} of your recordings', 0)
        from features import panns_model
        panns = panns_model()
        mine = learning.app_data(recordings, panns, lambda k, n: status.stage('fingerprint', f'Fingerprinting recording {k} of {n}', k / n))
        status.done_stage('fingerprint')

        version = learning.next_version()
        b, report = build(learning.combine(base, mine), status, version)
        report['runId'] = request.get('runId')
        save_version(b, report)
        status.done_stage('train')
        status.data.update(state='done', stage='done', progress=1.0, message=f'Version {version} is ready to activate',
                           finishedAt=_now(), result=report)
        status.save()
    except Exception as e:  # the app shows the reason; the active model is untouched
        status.data.update(state='failed', message='Training failed', error=f'{type(e).__name__}: {e}', finishedAt=_now(),
                           trace=traceback.format_exc()[-2000:])
        status.save()
        raise


def init():
    """Version 1: the datasets only (the same model as train.py's experiment F), with the odd-sound check, active."""
    base = load_datasets()
    print(f'{base.clips} clips; comparing and training (a few minutes)...')
    b, report = build(base, None, 1)
    save_version(b, report)
    learning.set_active(1)
    print(json.dumps({k: report[k] for k in ('version', 'trainedOn', 'comparison', 'familiarity')}, indent=2))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', type=Path)
    ap.add_argument('--init', action='store_true')
    a = ap.parse_args()
    if a.init:
        init()
    elif a.run:
        run(a.run)
    else:
        ap.error('give --run <folder> or --init')
