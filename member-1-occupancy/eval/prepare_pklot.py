"""Prepares the original UFPR PKLot dataset for the occupancy experiments.

PKLot layout:  <root>/<camera>/<Sunny|Cloudy|Rainy>/<YYYY-MM-DD>/<YYYY-MM-DD_HH_MM_SS>.jpg + .xml
Each XML lists the parking spaces of that frame:  <space id occupied="0|1"> <rotatedRect/> <contour><point x y/>...

Steps (run in order; every step reads the previous step's output from --out):
  index    walk the folders, parse every XML           -> manifest.csv, spaces.csv.gz
  split    day-level split, UFPR05 held out as unseen  -> splits.json
  convert  weak vehicle labels for YOLO training       -> yolo/{images,labels}/{train,val}/, pklot_vehicle.yaml
  gold     test images for hand-verified boxes         -> gold/images, gold/cvat_preannotations.zip

Weak labels: the bounding rectangle of every *occupied* space outline becomes one `vehicle` box. These mark the
slot, not the exact car, so they are training labels only. Detection accuracy is reported on a separate
hand-verified gold set, never on these boxes.

Masking: PKLot annotates only some spaces per view, so every written image is greyed out outside the annotated
spaces (plus a small margin). Otherwise unlabelled cars would be learnt as background.

Usage (from member-1-occupancy/):
  .venv/Scripts/python eval/prepare_pklot.py index   --root "<...>/PKLot_original/PKLot/PKLot" --out "<...>/PKLot_prepared"
  .venv/Scripts/python eval/prepare_pklot.py split   --out "<...>/PKLot_prepared"
  .venv/Scripts/python eval/prepare_pklot.py convert --out "<...>/PKLot_prepared"
  .venv/Scripts/python eval/prepare_pklot.py gold    --out "<...>/PKLot_prepared"
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import pandas as pd

CAMERAS = ('PUCPR', 'UFPR04', 'UFPR05')
CONDITIONS = ('Sunny', 'Cloudy', 'Rainy')
HELD_OUT_CAMERA = 'UFPR05'           # never trained or tuned on: the unseen-site test (NFR-06)
SPLIT_TARGETS = {'train': 0.70, 'val': 0.15, 'test': 0.15}
IMAGE_SIZE = (1280, 720)             # every PKLot frame; checked during convert


@dataclass(frozen=True)
class Space:
    space_id: int
    occupied: int | None             # None when the XML has no occupied attribute (unknown, ~3.6% of spaces)
    contour: tuple[tuple[float, float], ...]


def parse_xml(path: Path) -> list[Space]:
    """Reads one PKLot annotation. Falls back to the rotated rectangle when a space has no contour."""
    spaces: list[Space] = []
    for el in ET.parse(path).getroot().iter('space'):
        occ = el.get('occupied')
        points = tuple((float(p.get('x')), float(p.get('y'))) for p in el.iter('point'))
        if len(points) < 3:
            points = _rect_corners(el.find('rotatedRect'))
        if len(points) < 3:
            continue
        spaces.append(Space(int(el.get('id')), int(occ) if occ in ('0', '1') else None, points))
    return spaces


def _rect_corners(rect: ET.Element | None) -> tuple[tuple[float, float], ...]:
    if rect is None or rect.find('center') is None or rect.find('size') is None:
        return ()
    import math
    c, s = rect.find('center'), rect.find('size')
    cx, cy, w, h = (float(c.get('x')), float(c.get('y')), float(s.get('w')), float(s.get('h')))
    a = math.radians(float(rect.find('angle').get('d')) if rect.find('angle') is not None else 0.0)
    ca, sa = math.cos(a), math.sin(a)
    return tuple((cx + dx * ca - dy * sa, cy + dx * sa + dy * ca)
                 for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)))


def outline_bbox(contour, width: int, height: int) -> tuple[float, float, float, float]:
    """Axis-aligned box around a space outline, clipped to the image."""
    xs, ys = [p[0] for p in contour], [p[1] for p in contour]
    return (max(0.0, min(xs)), max(0.0, min(ys)), min(float(width), max(xs)), min(float(height), max(ys)))


def yolo_line(bbox, width: int, height: int, cls: int = 0) -> str:
    x1, y1, x2, y2 = bbox
    return f'{cls} {(x1 + x2) / 2 / width:.6f} {(y1 + y2) / 2 / height:.6f} {(x2 - x1) / width:.6f} {(y2 - y1) / height:.6f}'


# ---------------------------------------------------------------- index

def build_index(root: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    images, spaces = [], []
    for camera in CAMERAS:
        for condition in CONDITIONS:
            for xml in sorted((root / camera / condition).glob('*/*.xml')):
                jpg = xml.with_suffix('.jpg')
                if not jpg.exists():
                    continue
                image_id = f'{camera}/{condition}/{xml.parent.name}/{xml.stem}'
                try:
                    parsed = parse_xml(xml)
                except ET.ParseError:
                    images.append(_image_row(image_id, camera, condition, xml, jpg, [], parse_error=True))
                    continue
                images.append(_image_row(image_id, camera, condition, xml, jpg, parsed))
                for s in parsed:
                    spaces.append({'image_id': image_id, 'space_id': s.space_id, 'occupied': s.occupied,
                                   'contour': json.dumps([[round(x, 1), round(y, 1)] for x, y in s.contour])})
    return pd.DataFrame(images), pd.DataFrame(spaces)


def _image_row(image_id, camera, condition, xml: Path, jpg: Path, parsed: list[Space], parse_error=False) -> dict:
    stem = xml.stem                                    # 2012-12-07_17_12_25
    return {
        'image_id': image_id, 'camera': camera, 'condition': condition, 'date': xml.parent.name,
        'time': stem[11:].replace('_', ':'), 'hour': int(stem[11:13]),
        'jpg': str(jpg), 'xml': str(xml),
        'n_spaces': len(parsed),
        'n_occupied': sum(s.occupied == 1 for s in parsed),
        'n_empty': sum(s.occupied == 0 for s in parsed),
        'n_unknown': sum(s.occupied is None for s in parsed),
        'parse_error': parse_error,
    }


# ---------------------------------------------------------------- split

def assign_days(manifest: pd.DataFrame, seed: int = 0) -> dict[str, str]:
    """Assigns every (camera, date) to exactly one split.

    Frames from the same day are near-duplicates, and one day can sit under two weather folders (the weather
    changed), so the unit of splitting is the camera-day. The held-out camera goes wholly to 'xsite'. Other days
    are shuffled with `seed` and each is given to the split that is furthest below its target share of images,
    measured per weather condition, so every split gets a similar condition mix.
    """
    days: dict[str, str] = {}
    held = manifest[manifest.camera == HELD_OUT_CAMERA]
    for key in (held.camera + '/' + held.date).unique():
        days[key] = 'xsite'

    for camera in sorted(set(manifest.camera) - {HELD_OUT_CAMERA}):
        cam = manifest[manifest.camera == camera]
        per_day = cam.groupby(['date', 'condition']).size().unstack(fill_value=0)
        totals = per_day.sum()
        filled = {s: pd.Series(0.0, index=per_day.columns) for s in SPLIT_TARGETS}
        order = list(per_day.index)
        random.Random(f'{seed}:{camera}').shuffle(order)
        for date in order:
            counts = per_day.loc[date]
            def deficit(split: str) -> float:
                gap = SPLIT_TARGETS[split] * totals - filled[split]
                return float((counts * gap / totals.clip(lower=1)).sum())
            best = max(SPLIT_TARGETS, key=deficit)
            filled[best] += counts
            days[f'{camera}/{date}'] = best
    return days


def split_report(manifest: pd.DataFrame, days: dict[str, str]) -> pd.DataFrame:
    m = manifest.assign(split=(manifest.camera + '/' + manifest.date).map(days))
    return m.pivot_table(index=['camera', 'condition'], columns='split', values='image_id', aggfunc='count', fill_value=0)


# ---------------------------------------------------------------- masking

MASK_FILL = 114        # the grey YOLO uses for letterbox padding
MASK_MARGIN_PX = 12    # vehicles overhang their slot outline; keep a margin so their edges are not cut off


def space_mask(contours, width: int, height: int, margin: int = MASK_MARGIN_PX):
    """uint8 mask (255 = keep) covering every annotated space, grown by `margin` pixels."""
    mask = np.zeros((height, width), np.uint8)
    for c in contours:
        cv2.fillPoly(mask, [np.round(np.asarray(c, np.float32)).astype(np.int32)], 255)
    if margin > 0:
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margin + 1, 2 * margin + 1)))
    return mask


def apply_mask(img, mask):
    """PKLot only annotates some spaces, so cars elsewhere in the frame have no box. Training on them unmasked
    would teach the detector that those cars are background; greying out everything outside the annotated spaces
    removes them. The same masking is applied to the gold test images so training and test match."""
    out = img.copy()
    out[mask == 0] = MASK_FILL
    return out


def _write_masked(src: Path, dst: Path, contours) -> None:
    img = cv2.imread(str(src))
    if img is None:
        raise OSError(f'Cannot read image {src}')
    h, w = img.shape[:2]
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()        # never write through an old hard link into the original dataset
    cv2.imwrite(str(dst), apply_mask(img, space_mask(contours, w, h)), [cv2.IMWRITE_JPEG_QUALITY, 95])


def _usable(m: pd.DataFrame) -> pd.Series:
    """Images whose every space has a known state (an unknown space may hold an unlabelled car)."""
    return (m.n_unknown == 0) & ~m.parse_error & (m.n_spaces > 0)


# ---------------------------------------------------------------- convert

def convert(out: Path, manifest: pd.DataFrame, spaces: pd.DataFrame, days: dict[str, str],
            splits=('train', 'val')) -> dict:
    """Writes masked YOLO images + weak labels for the training splits into <out>/yolo (rebuilt from scratch)."""
    m = manifest.assign(split=(manifest.camera + '/' + manifest.date).map(days))
    usable = m[m.split.isin(splits) & _usable(m)]
    contours = spaces.groupby('image_id').contour.apply(lambda s: [json.loads(c) for c in s])
    occ = spaces[spaces.occupied == 1].groupby('image_id').contour.apply(list)
    yolo = out / 'yolo'
    if yolo.exists():
        shutil.rmtree(yolo)  # removes links/files in our output folder only; originals are untouched
    stats = defaultdict(int)
    w, h = IMAGE_SIZE
    for row in usable.itertuples():
        name = row.image_id.replace('/', '__')
        _write_masked(Path(row.jpg), yolo / 'images' / row.split / f'{name}.jpg', contours[row.image_id])
        lbl = yolo / 'labels' / row.split / f'{name}.txt'
        lbl.parent.mkdir(parents=True, exist_ok=True)
        lines = [yolo_line(outline_bbox(json.loads(c), w, h), w, h) for c in occ.get(row.image_id, [])]
        lbl.write_text('\n'.join(lines) + ('\n' if lines else ''))
        stats[f'{row.split}_images'] += 1
        stats[f'{row.split}_boxes'] += len(lines)
    stats['skipped_unknown_or_error'] = int((m.split.isin(splits) & ~_usable(m)).sum())
    (out / 'pklot_vehicle.yaml').write_text(
        f'# Weak vehicle labels from PKLot occupied-space outlines; images masked outside annotated spaces.\n'
        f'path: {yolo.as_posix()}\ntrain: images/train\nval: images/val\nnames:\n  0: vehicle\n')
    return dict(stats)


# ---------------------------------------------------------------- gold set

def sample_gold(manifest: pd.DataFrame, days: dict[str, str], per_stratum: int = 22, seed: int = 0) -> pd.DataFrame:
    """Picks test images for hand-verified vehicle boxes: `per_stratum` per camera x condition from the test and
    xsite splits (fewer when a stratum is smaller), spread across days by sampling at random with a fixed seed."""
    m = manifest.assign(split=(manifest.camera + '/' + manifest.date).map(days))
    pool = m[m.split.isin(('test', 'xsite')) & _usable(m)]
    picked = [g.sample(min(per_stratum, len(g)), random_state=seed)
              for _, g in pool.groupby(['camera', 'condition'], sort=True)]
    return pd.concat(picked).sort_values('image_id').reset_index(drop=True)


def write_gold(out: Path, gold: pd.DataFrame, spaces: pd.DataFrame) -> Path:
    """Writes masked gold images plus a CVAT 'YOLO 1.1' pre-annotation package.

    Pre-annotations are the occupied-space boxes. The annotator tightens each box to the vehicle, deletes boxes
    with no vehicle, and adds any vehicle inside the visible (unmasked) area that has no box.
    """
    root = out / 'gold'
    if root.exists():
        shutil.rmtree(root)
    pre = root / 'cvat_preannotations'
    data = pre / 'obj_train_data'
    data.mkdir(parents=True)
    contours = spaces.groupby('image_id').contour.apply(lambda s: [json.loads(c) for c in s])
    occ = spaces[spaces.occupied == 1].groupby('image_id').contour.apply(list)
    w, h = IMAGE_SIZE
    names = []
    for row in gold.itertuples():
        name = row.image_id.replace('/', '__')
        _write_masked(Path(row.jpg), root / 'images' / f'{name}.jpg', contours[row.image_id])
        lines = [yolo_line(outline_bbox(json.loads(c), w, h), w, h) for c in occ.get(row.image_id, [])]
        (data / f'{name}.txt').write_text('\n'.join(lines) + ('\n' if lines else ''))
        names.append(f'obj_train_data/{name}.jpg')
    (pre / 'obj.names').write_text('vehicle\n')
    (pre / 'obj.data').write_text('classes = 1\nnames = obj.names\ntrain = train.txt\n')
    (pre / 'train.txt').write_text('\n'.join(names) + '\n')
    gold.to_csv(root / 'gold_manifest.csv', index=False)
    shutil.make_archive(str(root / 'cvat_preannotations'), 'zip', pre)
    return root


# ---------------------------------------------------------------- cli

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('step', choices=('index', 'split', 'convert', 'gold'))
    ap.add_argument('--root', type=Path, help='PKLot folder holding PUCPR/UFPR04/UFPR05 (index step)')
    ap.add_argument('--out', type=Path, required=True, help='output folder (outside git)')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--per-stratum', type=int, default=22, help='gold images per camera x condition')
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)

    if a.step == 'index':
        if not a.root:
            ap.error('--root is required for index')
        manifest, spaces = build_index(a.root)
        manifest.to_csv(a.out / 'manifest.csv', index=False)
        spaces.to_csv(a.out / 'spaces.csv.gz', index=False, compression='gzip')
        print(f'{len(manifest)} images, {len(spaces)} spaces, {int(manifest.parse_error.sum())} unreadable XML')
        print(manifest.pivot_table(index='camera', columns='condition', values='image_id', aggfunc='count'))
        print(f"spaces: occupied={int(manifest.n_occupied.sum())} empty={int(manifest.n_empty.sum())} "
              f"unknown={int(manifest.n_unknown.sum())}; images with unknown spaces={int((manifest.n_unknown > 0).sum())}")

    elif a.step == 'split':
        manifest = pd.read_csv(a.out / 'manifest.csv')
        days = assign_days(manifest, a.seed)
        (a.out / 'splits.json').write_text(json.dumps(
            {'seed': a.seed, 'held_out_camera': HELD_OUT_CAMERA, 'targets': SPLIT_TARGETS, 'days': days}, indent=1))
        print(split_report(manifest, days))

    elif a.step == 'convert':
        manifest = pd.read_csv(a.out / 'manifest.csv')
        spaces = pd.read_csv(a.out / 'spaces.csv.gz')
        days = json.loads((a.out / 'splits.json').read_text())['days']
        print(convert(a.out, manifest, spaces, days))

    elif a.step == 'gold':
        manifest = pd.read_csv(a.out / 'manifest.csv')
        spaces = pd.read_csv(a.out / 'spaces.csv.gz')
        days = json.loads((a.out / 'splits.json').read_text())['days']
        gold = sample_gold(manifest, days, a.per_stratum, a.seed)
        root = write_gold(a.out, gold, spaces)
        print(gold.pivot_table(index='camera', columns='condition', values='image_id', aggfunc='count'))
        print(f'{len(gold)} gold images -> {root}')


if __name__ == '__main__':
    main()
