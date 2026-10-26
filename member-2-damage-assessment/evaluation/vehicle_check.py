"""Does the vehicle finder say "vehicle" when there is one, and "no vehicle" when there is none?

The live walk-around shows damage only while a vehicle is in view (or was in the last 3 s), because the damage model only
knows cars and finds "damage" in anything else. This measures the vehicle finder (COCO YOLO, predictor.look) on:
  1. CarDD test photos, which all show a car: whole car ("complete") vs part of one ("partial", close-ups);
  2. COCO128 images with no vehicle in them (people, rooms, animals, food): how often a vehicle is wrongly found, how
     often a person is recognised, and how often damage boxes would be shown with and without the vehicle gate.
Writes results/vehicle_check.md.

Run (from member-2-damage-assessment):
  .venv\\Scripts\\python evaluation\\vehicle_check.py "<CarDD_COCO folder>" "<coco128 folder>"
COCO128 (128 COCO images, CC BY 4.0): https://github.com/ultralytics/assets/releases/download/v0.0.0/coco128.zip
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'backend'))
from app import config  # noqa: E402
from app.predictor import SegModel, look  # noqa: E402

VEHICLE_IDS = {2, 3, 5, 7}  # COCO car, motorcycle, bus, truck
PERSON_ID = 0
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def xlsx_rows(path: Path):
    """Rows of the first sheet as lists of strings (a small reader, so no spreadsheet package is needed)."""
    with zipfile.ZipFile(path) as z:
        shared = [''.join(t.text or '' for t in si.iter(f'{{{NS["m"]}}}t'))
                  for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for row in sheet.iter(f'{{{NS["m"]}}}row'):
        cells = {}
        for c in row.findall('m:c', NS):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find('m:v', NS)
            text = '' if v is None else v.text
            cells[col] = shared[int(text)] if c.get('t') == 's' and text else (text or '')
        yield [cells.get(chr(65 + i), '') for i in range(max(10, len(cells)))]


def pct(a, b):
    return f'{a} of {b} ({a / b:.0%})' if b else '-'


def main(cardd: Path, coco128: Path):
    coco = SegModel(config.COCO_MODEL_PATH)
    damage = SegModel(config.MODEL_PATH)

    # 1. CarDD test photos: every one shows a car
    rows = list(xlsx_rows(cardd / 'annotations' / 'image_info.xlsx'))
    head = [h.strip().lower() for h in rows[0]]
    view = {r[head.index('file_name')]: r[head.index('complete or partial')].strip().lower() for r in rows[1:] if r[1]}
    test = json.loads((cardd / 'annotations' / 'instances_test2017.json').read_text(encoding='utf-8'))['images']
    found = {'complete': [0, 0], 'partial': [0, 0]}
    for img in test:
        kind = view.get(img['file_name'], 'partial')
        vehicle, _ = look(coco, cv2.imread(str(cardd / 'test2017' / img['file_name'])))
        found.setdefault(kind, [0, 0])
        found[kind][0] += vehicle is not None
        found[kind][1] += 1
    print('CarDD done', found)

    # 2. COCO128 images with no vehicle in them
    images = sorted((coco128 / 'images' / 'train2017').glob('*.jpg'))
    none = people = wrong = person_seen = boxes_before = boxes_after = 0
    for im in images:
        label = coco128 / 'labels' / 'train2017' / f'{im.stem}.txt'
        classes = {int(line.split()[0]) for line in label.read_text().splitlines() if line.strip()} if label.exists() else set()
        if classes & VEHICLE_IDS:
            continue
        none += 1
        image = cv2.imread(str(im))
        vehicle, person = look(coco, image)
        wrong += vehicle is not None
        if PERSON_ID in classes:
            people += 1
            person_seen += person
        shown = any(r['confidence'] >= config.CONFIDENCE for r in damage.predict(image, config.CONFIDENCE))
        boxes_before += shown
        boxes_after += shown and vehicle is not None
    print('COCO128 done')

    c, p = found['complete'], found['partial']
    lines = [
        '# Vehicle check: does the finder see the vehicle, and only the vehicle?',
        '',
        f'Vehicle finder: `{config.COCO_MODEL_PATH.name}` (COCO, car / motorcycle / bus / truck, confidence >= {config.VEHICLE_CONFIDENCE}), '
        f'`predictor.look`. Damage model: `{config.MODEL_PATH.name}`, findings from {config.CONFIDENCE}.',
        '',
        '## 1. Photos that show a car (CarDD test set, 374 photos)',
        '',
        '| CarDD photo | Vehicle found |',
        '|---|---|',
        f'| Whole car ("complete") | {pct(*c)} |',
        f'| Part of a car ("partial", close-ups) | {pct(*p)} |',
        '',
        '## 2. Images with no vehicle (COCO128: people, rooms, animals, food)',
        '',
        f'{none} of the 128 images have no car, motorcycle, bus or truck in their labels.',
        '',
        '| Measure | Result |',
        '|---|---|',
        f'| Vehicle wrongly found | {pct(wrong, none)} |',
        f'| Person recognised (images with a person) | {pct(person_seen, people)} |',
        f'| Damage boxes shown, before (no vehicle check) | {pct(boxes_before, none)} |',
        f'| Damage boxes shown, after (only with a vehicle) | {pct(boxes_after, none)} |',
        '',
        '## Reading it',
        '',
        '- A whole car, as in the walk-around (2-3 m away), is what the finder is reliable on. Close-ups (part of a panel)',
        '  are often not recognised as a vehicle: the walk-around therefore keeps damage visible for 3 s after it last saw a',
        '  vehicle, and the Close-up button always works.',
        '- Limits: COCO128 images come from COCO\'s training images, which the COCO vehicle finder learned from, so part 2 is',
        '  optimistic; it is a small sample. A photo or screen showing a car is (correctly, for a camera) seen as a car.',
    ]
    out = HERE / 'results' / 'vehicle_check.md'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main(Path(sys.argv[1]), Path(sys.argv[2]))
