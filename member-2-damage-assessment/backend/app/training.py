"""Sound model retraining, run by the service for the AutoSense API: one run at a time, as a separate low-priority
process (acoustic/retrain.py) so the service keeps answering while it trains. Each run has a folder
acoustic/model/runs/<id>/ with the recordings, request.json and the status.json the process keeps up to date.
"""
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from . import config
from .sound import classes

import learning  # noqa: E402  (acoustic/ is on sys.path, see sound.py)

RUNS_DIR = learning.MODEL_DIR / 'runs'
_processes: dict[str, subprocess.Popen] = {}


def _running() -> str | None:
    for run_id, p in list(_processes.items()):
        if p.poll() is None:
            return run_id
    return None


def start(recordings: list[tuple[str, bytes]], manifest: list[dict]) -> str:
    """recordings: (file name, bytes); manifest: one {file, label, situation, group} per recording."""
    if _running():
        raise RuntimeError('A training run is already in progress.')
    names = {name for name, _ in recordings}
    for m in manifest:
        if m.get('file') not in names:
            raise ValueError(f'No recording named {m.get("file")!r} was sent.')
        if m.get('label') not in classes.CLASSES or classes.SITUATION_OF.get(m['label']) != m.get('situation'):
            raise ValueError(f'{m.get("file")}: {m.get("label")!r} is not a {m.get("situation")} fault.')
    run_id = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6]
    folder = RUNS_DIR / run_id
    folder.mkdir(parents=True)
    for name, data in recordings:
        safe = re.sub(r'[^A-Za-z0-9._-]', '_', name)
        if safe != name:
            raise ValueError(f'Use plain file names ({name!r}).')
        (folder / name).write_bytes(data)
    (folder / 'request.json').write_text(json.dumps({'runId': run_id, 'recordings': manifest}, indent=2), encoding='utf-8')
    # Below-normal priority on Windows; nice on others: the web app stays responsive while it trains
    flags = subprocess.BELOW_NORMAL_PRIORITY_CLASS if os.name == 'nt' else 0
    _processes[run_id] = subprocess.Popen(
        [sys.executable, str(config.ACOUSTIC_DIR / 'retrain.py'), '--run', str(folder)],
        cwd=str(config.ACOUSTIC_DIR), creationflags=flags,
        stdout=open(folder / 'log.txt', 'w', encoding='utf-8'), stderr=subprocess.STDOUT,
        preexec_fn=(lambda: os.nice(10)) if os.name != 'nt' else None,
    )
    return run_id


def status(run_id: str) -> dict | None:
    if not re.fullmatch(r'[0-9A-Za-z-]+', run_id):
        return None
    path = RUNS_DIR / run_id / 'status.json'
    if not path.exists():
        return {'state': 'running', 'stage': 'collect', 'progress': 0, 'message': 'Starting'} if (RUNS_DIR / run_id).exists() else None
    data = json.loads(path.read_text(encoding='utf-8'))
    p = _processes.get(run_id)
    if data['state'] == 'running' and p is not None and p.poll() is not None:
        data.update(state='failed', error='The training process stopped unexpectedly (see log.txt in the run folder).')
    data.pop('trace', None)
    return data


def versions() -> dict:
    return {'active': learning.active_version(), 'running': _running(), 'versions': learning.versions()}
