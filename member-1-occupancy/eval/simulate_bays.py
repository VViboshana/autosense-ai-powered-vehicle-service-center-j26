"""Simulated service-bay footage for demos: check AI-generated clips, then build one "camera" video of up to 6 bays.

SIMULATED FOOTAGE IS FOR DEMONSTRATING THE APP ONLY. It is never evaluation data: no result measured on it may be
reported as model performance. Every frame of the composed video is stamped "SIMULATED".

Each clip shows ONE service bay from a fixed camera: empty at the start, a car drives in and parks, and stays parked to
the end. The car leaving is the same clip played backwards, so every bay cycles  empty -> arrive -> parked -> leave.

  check    run the detector(s) on a clip: is the parked car found, is the empty bay empty, where is the bay
  compose  tile the clips (3 x 2; 4 x 2 for 7-8 clips; 3 x 3 for 9) into one video with staggered timelines, plus <out>.bays.json with each
           bay's outline (normalised, from the parked car) and the expected state per second

Usage (from member-1-occupancy/):
  .venv/Scripts/python eval/simulate_bays.py check   --clip <bay1.mp4> --weights model/best.pt model/yolo11s.pt
  .venv/Scripts/python eval/simulate_bays.py compose --clips <bay1.mp4> ... <bay6.mp4> --weights model/yolo11s.pt
                                                     --out videos/sim-service-bays.mp4 --minutes 6
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

PANEL_W, PANEL_H, COLS, ROWS, FPS = 640, 360, 3, 2, 10
SHRINK = 0.08          # bay outline = the parked car's box, shrunk by this share on each side
EMPTY_S, PARKED_S = (20, 35), (30, 50)   # ranges for the hold times; each bay gets different values


def read_clip(path: Path) -> tuple[list[np.ndarray], float]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise SystemExit(f'Cannot open {path}')
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    if len(frames) < fps * 3:
        raise SystemExit(f'{path.name}: too short ({len(frames) / fps:.1f} s); use clips of at least 5 seconds.')
    return frames, fps


def biggest(vehicles):
    return max(vehicles, key=lambda v: (v.bbox[2] - v.bbox[0]) * (v.bbox[3] - v.bbox[1]), default=None)


def bay_from_box(bbox, w: int, h: int) -> list[list[float]]:
    """Normalised rectangle: the parked car's box shrunk by SHRINK on each side (the car then covers ~100 % of it)."""
    x1, y1, x2, y2 = bbox
    dx, dy = (x2 - x1) * SHRINK, (y2 - y1) * SHRINK
    x1, x2, y1, y2 = (x1 + dx) / w, (x2 - dx) / w, (y1 + dy) / h, (y2 - dy) / h
    return [[round(x1, 4), round(y1, 4)], [round(x2, 4), round(y1, 4)], [round(x2, 4), round(y2, 4)], [round(x1, 4), round(y2, 4)]]


def check_clip(path: Path, weights: list[Path]) -> dict:
    """Per model: share of 'parked' frames (last 25 %) where a vehicle covers the bay, and of 'empty' frames (first
    10 %) where it does not. The bay comes from the first model's detection on the last frame."""
    from app import config
    from app.association import score, to_polygon
    from app.detector import Detector
    from app.roi import apply_mask, bay_mask

    frames, fps = read_clip(path)
    h, w = frames[0].shape[:2]
    step = max(1, round(fps / 2))
    sample = list(range(0, len(frames), step))
    empty = [i for i in sample if i < len(frames) * 0.10]
    parked = [i for i in sample if i >= len(frames) * 0.75]
    report, bay = {'clip': path.name, 'size': f'{w}x{h}', 'seconds': round(len(frames) / fps, 1), 'models': {}}, None
    for wpath in weights:
        det = Detector(wpath)
        fine_tuned = det.classes is None
        last = biggest(det.detect(frames[-1]))
        if bay is None:
            if last is None:
                report['verdict'] = 'NO CAR FOUND on the last frame: regenerate the clip (see the prompt tips).'
                return report
            bay = bay_from_box(last.bbox, w, h)
        poly = to_polygon([(x * w, y * h) for x, y in bay])
        mask = bay_mask([bay], w, h) if fine_tuned else None   # the fine-tuned model is used with ROI masking
        def present(i):
            img = apply_mask(frames[i], mask) if mask is not None else frames[i]
            return max((score(v.bbox, poly) for v in det.detect(img, config.CONFIDENCE)), default=0.0) >= 0.4
        report['models'][wpath.name] = {
            'masked': mask is not None,
            'parkedFound': round(sum(present(i) for i in parked) / max(1, len(parked)), 2),
            'emptyClear': round(sum(not present(i) for i in empty) / max(1, len(empty)), 2),
        }
    report['bay'] = bay
    ok = {m: r['parkedFound'] >= 0.9 and r['emptyClear'] >= 0.9 for m, r in report['models'].items()}
    report['works'] = ok
    report['verdict'] = ('usable with: ' + ', '.join(m for m, v in ok.items() if v)) if any(ok.values()) else \
        'NOT USABLE: the car is not found reliably, or the empty bay is not empty at the start. Regenerate.'
    return report


def panel(frame: np.ndarray) -> np.ndarray:
    return cv2.resize(frame, (PANEL_W, PANEL_H), interpolation=cv2.INTER_AREA)


def timeline(frames: list[np.ndarray], clip_fps: float, seconds: float, seed: int,
             empty_s: tuple[int, int] = EMPTY_S, parked_s: tuple[int, int] = PARKED_S,
             first_s: tuple[int, int] | None = None) -> tuple[list[np.ndarray], list[int | None]]:
    """Panel frames at FPS for `seconds`: empty hold -> arrive -> parked hold -> leave (reversed) -> repeat, and the
    expected state per output frame (0 free, 1 occupied, None while the car moves). `first_s`: when the first car starts
    to arrive (seconds from the start, random in that range), so a live demo shows cars soon after it is started."""
    rng = np.random.default_rng(seed)
    clip = [panel(frames[int(i)]) for i in np.arange(0, len(frames), clip_fps / FPS)]
    first_still = len(clip) // 10                     # the clip starts with the bay empty
    moving = clip[first_still:]
    out, state = [], []
    lead = int(rng.integers(*first_s) if first_s else rng.integers(0, empty_s[1])) * FPS   # stagger the bays
    out += [clip[0]] * lead
    state += [0] * lead
    first = first_s is not None
    while len(out) < seconds * FPS:
        e = 0 if first else int(rng.integers(*empty_s)) * FPS
        first = False
        p = int(rng.integers(*parked_s)) * FPS
        out += [clip[0]] * e + moving + [clip[-1]] * p + moving[::-1]
        state += [0] * e + [None] * len(moving) + [1] * p + [None] * len(moving)
    n = int(seconds * FPS)
    return out[:n], state[:n]


def compose(clips: list[Path], weights: Path, out: Path, minutes: float,
            empty_s: tuple[int, int] = EMPTY_S, parked_s: tuple[int, int] = PARKED_S,
            first_s: tuple[int, int] | None = None) -> None:
    if not 1 <= len(clips) <= 9:
        raise SystemExit('Give 1 to 9 clips.')
    # 3 x 2 panels for up to 6 bays (1920x720), 4 x 2 for 7 or 8 (2560x720), 3 x 3 for 9 (1920x1080)
    cols, rows = (3, 2) if len(clips) <= 6 else (4, 2) if len(clips) <= 8 else (3, 3)
    bays, views, panels, truth = {}, {}, [], {}
    for k, path in enumerate(clips):
        rep = check_clip(path, [weights])
        if not any(rep.get('works', {}).values()):
            raise SystemExit(f"{path.name}: {rep['verdict']}")
        frames, fps = read_clip(path)
        seq, states = timeline(frames, fps, minutes * 60, seed=k, empty_s=empty_s, parked_s=parked_s, first_s=first_s)
        col, row = k % cols, k // cols
        (x1, y1), _, (x2, y2), _ = rep['bay']
        # the panel's bay, in the coordinates of the whole 1920x720 picture
        bx = lambda x: round((col + x) / cols, 4)    # noqa: E731
        by = lambda y: round((row + y) / rows, 4)    # noqa: E731
        code = f'S{k + 1}'
        bays[code] = [[bx(x1), by(y1)], [bx(x2), by(y1)], [bx(x2), by(y2)], [bx(x1), by(y2)]]
        views[code] = [bx(0), by(0), bx(1), by(1)]   # the bay's own panel: live pictures are cropped inside it
        truth[code] = states[::FPS]                   # one value per second
        panels.append(seq)
        print(f'{code}: {path.name} ok ({rep["verdict"]})')
    blank = np.full((PANEL_H, PANEL_W, 3), 40, np.uint8)
    out.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*'mp4v'), FPS, (PANEL_W * cols, PANEL_H * rows))
    for i in range(int(minutes * 60 * FPS)):
        tiles = [p[i] if p is not None else blank for p in panels] + [blank] * (cols * rows - len(panels))
        lines = [np.hstack(tiles[r * cols:(r + 1) * cols]) for r in range(rows)]
        frame = np.vstack(lines)
        for k in range(len(panels)):
            col, row = k % cols, k // cols
            cv2.putText(frame, f'S{k + 1}  SIMULATED (AI-generated)', (col * PANEL_W + 8, row * PANEL_H + PANEL_H - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
        writer.write(frame)
    writer.release()
    meta = {'simulated': True, 'note': 'AI-generated demo footage. Not evaluation data.', 'fps': FPS,
            'clips': [c.name for c in clips], 'bays': bays, 'views': views, 'truthPerSecond': truth}
    out.with_suffix('.bays.json').write_text(json.dumps(meta, indent=1))
    print(f'wrote {out} and {out.with_suffix(".bays.json")}')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('check')
    c.add_argument('--clip', type=Path, required=True)
    c.add_argument('--weights', type=Path, nargs='+', required=True)
    m = sub.add_parser('compose')
    m.add_argument('--clips', type=Path, nargs='+', required=True)
    m.add_argument('--weights', type=Path, required=True, help='the model the service will run')
    m.add_argument('--out', type=Path, required=True)
    m.add_argument('--minutes', type=float, default=6)
    m.add_argument('--empty-s', type=int, nargs=2, default=list(EMPTY_S), metavar=('MIN', 'MAX'), help='seconds a bay stays empty')
    m.add_argument('--first-s', type=int, nargs=2, default=None, metavar=('MIN', 'MAX'),
                   help='when the first car of each bay starts to arrive (default: after a normal empty period)')
    m.add_argument('--parked-s', type=int, nargs=2, default=list(PARKED_S), metavar=('MIN', 'MAX'),
                   help='seconds a car stays parked (long enough for a damage inspection in a demo: e.g. 240 360)')
    a = ap.parse_args()
    if a.cmd == 'check':
        print(json.dumps(check_clip(a.clip, a.weights), indent=1))
    else:
        compose(a.clips, a.weights, a.out, a.minutes, tuple(a.empty_s), tuple(a.parked_s), tuple(a.first_s) if a.first_s else None)


if __name__ == '__main__':
    main()
