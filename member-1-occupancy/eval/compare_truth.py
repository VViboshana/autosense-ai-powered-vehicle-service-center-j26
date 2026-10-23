"""End-to-end check of the occupancy pipeline on a PKLot time-lapse video against its PKLot labels.

The time-lapse (videos/<name>.mp4) shows each PKLot image for `holdSeconds`; <name>.truth.json holds the bay outlines
(normalised) and, per image, whether each bay is occupied (1) or free (0) according to PKLot. A bay's result for an
image is its confirmed state at the end of that image's hold (just before the next image starts); `uncertain`
counts as a mismatch. With the default rules (occupied after 3 s, free after 5 s) a 6 s hold leaves time to confirm.

Two ways to get the transitions:
  run   process the video in this process, with the same pipeline the service uses
  job   score a saved GET /video-jobs/{id} response of the running service (JSON file)

Usage (from member-1-occupancy/):
  .venv/Scripts/python eval/compare_truth.py run --video videos/pklot-ufpr04-timelapse.mp4 --weights model/best.pt --mask on --out <dir>
  .venv/Scripts/python eval/compare_truth.py job --truth videos/pklot-ufpr04-timelapse.truth.json --job job.json --out <dir>
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

STATE = {1: 'occupied', 0: 'free'}


def state_at(transitions: list[dict], bay: str, t: float) -> str:
    """The bay's confirmed state at time t, from transitions {bayId, toState, atSeconds}."""
    s = 'uncertain'
    for tr in sorted((x for x in transitions if x['bayId'] == bay), key=lambda x: x['atSeconds']):
        if tr['atSeconds'] <= t:
            s = tr['toState']
    return s


def score(truth: dict, transitions: list[dict]) -> dict:
    hold, frames = truth['holdSeconds'], truth['frames']
    rows, confusion = [], Counter()
    for bay, labels in truth['truth'].items():
        for i, label in enumerate(labels):
            t = (i + 1) * hold - 1e-6
            got = state_at(transitions, bay, t)
            confusion[(STATE[label], got)] += 1
            if got != STATE[label]:
                rows.append({'bay': bay, 'image': i, 'frame': frames[i], 'time': truth['times'][i],
                             'expected': STATE[label], 'got': got})
    total = sum(confusion.values())
    return {'matched': total - len(rows), 'total': total,
            'confusion': {f'{e}->{g}': n for (e, g), n in sorted(confusion.items())}, 'mismatches': rows}


def run(video: Path, truth: dict, weights: Path, mask: bool, sample_fps: float) -> tuple[list[dict], dict]:
    from app.detector import Detector
    from app.pipeline import BayConfig, process_video
    from app.roi import margin_for
    from app.state_machine import Rules
    import cv2

    detector = Detector(weights)
    bays = [BayConfig(b, p) for b, p in truth['bays'].items()]
    seen = []
    started = time.perf_counter()
    progress = process_video(str(video), bays, detector, Rules(), sample_fps, mask=mask,
                             on_transition=lambda t: seen.append(
                                 {'bayId': t.bay_id, 'fromState': t.from_state, 'toState': t.to_state,
                                  'atSeconds': t.at}))
    elapsed = time.perf_counter() - started
    cap = cv2.VideoCapture(str(video))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    info = {'weights': weights.name, 'mask': mask, 'marginPx': margin_for(width, height) if mask else 0,
            'frame': f'{width}x{height}', 'sampleFps': sample_fps, 'framesAnalysed': progress.frames_processed,
            'seconds': round(elapsed, 1), 'msPerFrame': round(1000 * elapsed / max(1, progress.frames_processed))}
    return seen, info


def write(out: Path, result: dict, info: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    (out / 'result.json').write_text(json.dumps({'info': info, **result}, indent=1))
    lines = [f"# End-to-end check: {out.name}", '',
             ', '.join(f'{k} `{v}`' for k, v in info.items()), '',
             f"**{result['matched']} / {result['total']}** bay states match the PKLot labels.", '',
             '| expected -> got | count |', '|---|---|',
             *[f'| {k} | {v} |' for k, v in result['confusion'].items()], '']
    if result['mismatches']:
        lines += ['| bay | image | time | expected | got |', '|---|---|---|---|---|',
                  *[f"| {m['bay']} | {m['image']} | {m['time']} | {m['expected']} | {m['got']} |"
                    for m in result['mismatches']]]
    (out / 'report.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--video', type=Path, required=True)
    r.add_argument('--truth', type=Path, help='default: <video>.truth.json')
    r.add_argument('--weights', type=Path, required=True)
    r.add_argument('--mask', choices=['on', 'off'], required=True)
    r.add_argument('--sample-fps', type=float, default=2.0)
    r.add_argument('--out', type=Path, required=True)
    j = sub.add_parser('job')
    j.add_argument('--truth', type=Path, required=True)
    j.add_argument('--job', type=Path, required=True, help='saved GET /video-jobs/{id} response')
    j.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()

    if a.cmd == 'run':
        truth = json.loads((a.truth or a.video.with_suffix('.truth.json')).read_text())
        transitions, info = run(a.video, truth, a.weights, a.mask == 'on', a.sample_fps)
    else:
        truth = json.loads(a.truth.read_text())
        job = json.loads(a.job.read_text())
        transitions = job['transitions']
        info = {'job': job['jobId'], 'status': job['status'], 'mask': job.get('roiMask'),
                'framesAnalysed': job['framesProcessed']}
    write(a.out, score(truth, transitions), info)


if __name__ == '__main__':
    main()
