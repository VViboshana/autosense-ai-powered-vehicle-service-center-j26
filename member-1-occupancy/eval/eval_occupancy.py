"""Per-space occupancy evaluation on PKLot (hypotheses H1 and H3).

For every image, a detector finds vehicles, each annotated parking space is scored against them with an association
method (association.py), and the space is predicted occupied when the score reaches a threshold. Predictions are
compared with PKLot's occupied/empty labels; spaces with unknown state are left out.

This evaluates single frames. PKLot frames are about five minutes apart, so the temporal rules in state_machine.py
cannot be evaluated here; that needs video.

Steps:
  detect  run a model once and cache its boxes        -> <out>/occupancy/<run>/detections.csv.gz, timing.csv
  score   pick each method's threshold on `val` (max F1), report it on `test` and `xsite`
                                                       -> <out>/occupancy/<run>/{thresholds,metrics}.csv, report.md

Usage (from member-1-occupancy/):
  .venv/Scripts/python eval/eval_occupancy.py detect --out "<...>/PKLot_prepared" --weights yolo11s.pt --run zs_yolo11s_1280
  .venv/Scripts/python eval/eval_occupancy.py score  --out "<...>/PKLot_prepared" --run zs_yolo11s_1280
Add --per-stratum 20 to `detect` for a quick run on a sample (20 images per split x camera x condition).
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app.association import METHODS, score, to_polygon  # noqa: E402

COCO_VEHICLES = (2, 3, 5, 7)   # car, motorcycle, bus, truck
DETECT_CONF = 0.1              # keep low-confidence boxes; the score step filters by --conf
THRESHOLD_GRID = {
    'coverage': np.round(np.arange(0.05, 0.96, 0.05), 2),
    'iou': np.round(np.arange(0.05, 0.96, 0.05), 2),
    'bottom_center': np.array([0.5]),   # binary score: inside or not
}


def load(out: Path, splits) -> tuple[pd.DataFrame, pd.DataFrame]:
    manifest = pd.read_csv(out / 'manifest.csv')
    days = json.loads((out / 'splits.json').read_text())['days']
    manifest['split'] = (manifest.camera + '/' + manifest.date).map(days)
    manifest = manifest[manifest.split.isin(splits) & ~manifest.parse_error & (manifest.n_spaces > 0)]
    spaces = pd.read_csv(out / 'spaces.csv.gz')
    spaces = spaces[spaces.image_id.isin(manifest.image_id) & spaces.occupied.notna()]
    return manifest, spaces


# ---------------------------------------------------------------- detect

def detect(out: Path, weights: str, run: str, imgsz: int, splits, per_stratum: int | None, masked: bool,
           device: str | None) -> Path:
    from ultralytics import YOLO
    manifest, spaces = load(out, splits)
    if per_stratum:
        manifest = (manifest.groupby(['split', 'camera', 'condition'], group_keys=False)
                    .apply(lambda g: g.sample(min(per_stratum, len(g)), random_state=0)))
    model = YOLO(weights)
    names = model.names
    classes = list(COCO_VEHICLES) if names.get(2) == 'car' else None   # COCO model vs our 1-class model
    contours = spaces.groupby('image_id').contour.apply(lambda s: [json.loads(c) for c in s]) if masked else None

    import cv2
    if masked:
        from prepare_pklot import apply_mask, space_mask
    rows, timing = [], []
    for i, r in enumerate(manifest.itertuples()):
        img = cv2.imread(r.jpg)
        if masked:
            img = apply_mask(img, space_mask(contours.get(r.image_id, []), img.shape[1], img.shape[0]))
        t = time.perf_counter()
        res = model.predict(img, imgsz=imgsz, conf=DETECT_CONF, classes=classes, verbose=False, device=device)[0]
        ms = (time.perf_counter() - t) * 1000
        for (x1, y1, x2, y2), c, k in zip(res.boxes.xyxy.tolist(), res.boxes.conf.tolist(), res.boxes.cls.tolist()):
            rows.append((r.image_id, round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1), round(c, 4), int(k)))
        timing.append((r.image_id, round(ms, 1)))
        if (i + 1) % 200 == 0:
            print(f'{i + 1}/{len(manifest)} images', flush=True)

    d = out / 'occupancy' / run
    d.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows, columns=['image_id', 'x1', 'y1', 'x2', 'y2', 'conf', 'cls']).to_csv(
        d / 'detections.csv.gz', index=False, compression='gzip')
    pd.DataFrame(timing, columns=['image_id', 'ms']).to_csv(d / 'timing.csv', index=False)
    import torch, ultralytics
    (d / 'run.json').write_text(json.dumps({
        'weights': weights, 'imgsz': imgsz, 'splits': list(splits), 'per_stratum': per_stratum, 'masked': masked,
        'detect_conf': DETECT_CONF, 'classes': classes, 'images': len(manifest),
        'device': device or ('cuda' if torch.cuda.is_available() else 'cpu'), 'cpu': platform.processor(),
        'ultralytics': ultralytics.__version__, 'date': time.strftime('%Y-%m-%d %H:%M'),
    }, indent=1))
    print(f'{len(manifest)} images, {len(rows)} boxes, median {np.median([t for _, t in timing]):.0f} ms/image -> {d}')
    return d


# ---------------------------------------------------------------- score

def space_scores(spaces: pd.DataFrame, dets: pd.DataFrame, conf: float) -> pd.DataFrame:
    """Best score per space for every method. Only boxes overlapping a space's bounding box are checked."""
    by_img = {k: g[['x1', 'y1', 'x2', 'y2']].to_numpy() for k, g in dets[dets.conf >= conf].groupby('image_id')}
    out = []
    for r in spaces.itertuples():
        poly = to_polygon(json.loads(r.contour))
        boxes = by_img.get(r.image_id)
        best = dict.fromkeys(METHODS, 0.0)
        if boxes is not None:
            minx, miny, maxx, maxy = poly.bounds
            near = boxes[(boxes[:, 0] < maxx) & (boxes[:, 2] > minx) & (boxes[:, 1] < maxy) & (boxes[:, 3] > miny)]
            for b in near:
                for m in METHODS:
                    best[m] = max(best[m], score(tuple(b), poly, m))
        out.append((r.image_id, r.space_id, int(r.occupied), *best.values()))
    return pd.DataFrame(out, columns=['image_id', 'space_id', 'occupied', *METHODS])


def metrics(y_true, y_pred) -> dict:
    y_true, y_pred = np.asarray(y_true, bool), np.asarray(y_pred, bool)
    tp, fp = int((y_true & y_pred).sum()), int((~y_true & y_pred).sum())
    fn, tn = int((y_true & ~y_pred).sum()), int((~y_true & ~y_pred).sum())
    p = tp / (tp + fp) if tp + fp else 0.0
    rc = tp / (tp + fn) if tp + fn else 0.0
    return {'n': len(y_true), 'accuracy': (tp + tn) / len(y_true) if len(y_true) else 0.0, 'precision': p,
            'recall': rc, 'f1': 2 * p * rc / (p + rc) if p + rc else 0.0, 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn}


def score_run(out: Path, run: str, conf: float) -> pd.DataFrame:
    d = out / 'occupancy' / run
    info = json.loads((d / 'run.json').read_text())
    dets = pd.read_csv(d / 'detections.csv.gz')
    manifest, spaces = load(out, info['splits'])
    timing = pd.read_csv(d / 'timing.csv')
    manifest = manifest[manifest.image_id.isin(timing.image_id)]
    s = space_scores(spaces[spaces.image_id.isin(manifest.image_id)], dets, conf)
    s = s.merge(manifest[['image_id', 'split', 'camera', 'condition']], on='image_id')

    tune = s[s.split == 'val']
    if tune.empty:
        raise SystemExit('No val images in this run: thresholds must be tuned on val, not on test.')
    chosen = {m: max(THRESHOLD_GRID[m], key=lambda th: metrics(tune.occupied, tune[m] >= th)['f1']) for m in METHODS}

    rows = []
    for m in METHODS:
        th = chosen[m]
        for split in ('val', 'test', 'xsite'):
            part = s[s.split == split]
            if part.empty:
                continue
            rows.append({'method': m, 'threshold': th, 'split': split, 'camera': 'all', 'condition': 'all',
                         **metrics(part.occupied, part[m] >= th)})
            for (cam, cond), g in part.groupby(['camera', 'condition']):
                rows.append({'method': m, 'threshold': th, 'split': split, 'camera': cam, 'condition': cond,
                             **metrics(g.occupied, g[m] >= th)})
    res = pd.DataFrame(rows)
    res.to_csv(d / 'metrics.csv', index=False)
    s.to_csv(d / 'space_scores.csv.gz', index=False, compression='gzip')
    _report(d, info, conf, chosen, res, timing)
    return res


def _report(d: Path, info: dict, conf: float, chosen: dict, res: pd.DataFrame, timing: pd.DataFrame) -> None:
    pct = lambda v: f'{100 * v:.1f}'
    lines = [f'# Occupancy evaluation: {d.name}', '',
             f"Weights `{info['weights']}`, imgsz {info['imgsz']}, masked={info['masked']}, detector conf >= {conf}, "
             f"{info['images']} images ({'sample of ' + str(info['per_stratum']) + ' per stratum' if info['per_stratum'] else 'all'}), "
             f"run {info['date']} on {info['device']}. Median inference {timing.ms.median():.0f} ms/image.",
             '', 'Thresholds chosen on **val** (max F1), applied unchanged to test and xsite (UFPR05, unseen camera).', '',
             '| method | threshold | split | accuracy | precision | recall | F1 | spaces |', '|---|---|---|---|---|---|---|---|']
    for r in res[res.camera == 'all'].itertuples():
        lines.append(f'| {r.method} | {r.threshold} | {r.split} | {pct(r.accuracy)} | {pct(r.precision)} | '
                     f'{pct(r.recall)} | {pct(r.f1)} | {r.n} |')
    lines += ['', '## F1 by condition (test and xsite)', '',
              '| method | split | camera | Sunny | Cloudy | Rainy | best - worst (pts) |', '|---|---|---|---|---|---|---|']
    per = res[(res.camera != 'all') & res.split.isin(['test', 'xsite'])]
    for (m, split, cam), g in per.groupby(['method', 'split', 'camera'], sort=False):
        f = g.set_index('condition').f1
        lines.append(f"| {m} | {split} | {cam} | {' | '.join(pct(f[c]) if c in f else '-' for c in ('Sunny', 'Cloudy', 'Rainy'))}"
                     f' | {pct(f.max() - f.min())} |')
    (d / 'report.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines))


# ---------------------------------------------------------------- cli

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('step', choices=('detect', 'score'))
    ap.add_argument('--out', type=Path, required=True, help='PKLot_prepared folder')
    ap.add_argument('--run', required=True, help='name for this run, e.g. zs_yolo11s_1280')
    ap.add_argument('--weights', default='yolo11s.pt')
    ap.add_argument('--imgsz', type=int, default=1280)
    ap.add_argument('--splits', default='val,test,xsite')
    ap.add_argument('--per-stratum', type=int, default=None)
    ap.add_argument('--masked', action='store_true', help='grey out non-annotated areas, as in training')
    ap.add_argument('--device', default=None, help="e.g. 'cpu' or '0'")
    ap.add_argument('--conf', type=float, default=0.25, help='detector confidence used when scoring')
    a = ap.parse_args()
    if a.step == 'detect':
        detect(a.out, a.weights, a.run, a.imgsz, a.splits.split(','), a.per_stratum, a.masked, a.device)
    else:
        score_run(a.out, a.run, a.conf)


if __name__ == '__main__':
    main()
