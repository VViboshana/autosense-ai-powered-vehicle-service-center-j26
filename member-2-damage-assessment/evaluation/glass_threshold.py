"""How sure must the damage model be before shattered glass counts as damage? Measured on the CarDD test set.

The model runs on every test photo at the "possible damage" threshold (0.10), as the service does. Each glass_shatter
region it finds is matched to the real shattered glass in that photo (box IoU >= 0.5, strongest first):
  - matched: real shattered glass, with the confidence the model gave it;
  - unmatched: a false alarm (e.g. a reflection or intact glass).
For each candidate bar, it counts how much real glass stays a finding, drops to "possible damage" (still shown to the
technician) or is missed, and how many false alarms stay findings. Writes results/glass_threshold.md.

Run (from member-2-damage-assessment):  .venv\\Scripts\\python evaluation\\glass_threshold.py "<CarDD_COCO folder>"
"""
import json
import sys
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'backend'))
from app import config  # noqa: E402
from app.predictor import SegModel  # noqa: E402

GLASS = 'glass_shatter'
IOU = 0.5
BARS = [0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70]
KEEP = 0.95  # the bar may move at most 5% of the real shattered glass (found today) down to "possible damage"


def iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union else 0.0


def main(coco: Path):
    ann = json.loads((coco / 'annotations' / 'instances_test2017.json').read_text(encoding='utf-8'))
    glass_id = next(c['id'] for c in ann['categories'] if c['name'] == 'glass shatter')
    truth: dict[int, list] = {}
    for a in ann['annotations']:
        if a['category_id'] == glass_id:
            x, y, w, h = a['bbox']
            truth.setdefault(a['image_id'], []).append([x, y, x + w, y + h])

    model = SegModel(config.MODEL_PATH)
    real, false = [], []  # confidences; a real glass the model did not find at all counts as 0
    for n, img in enumerate(ann['images'], 1):
        image = cv2.imread(str(coco / 'test2017' / img['file_name']))
        found = sorted((r for r in model.predict(image, config.POSSIBLE_CONFIDENCE) if r['label'] == GLASS),
                       key=lambda r: r['confidence'], reverse=True)
        open_truth = list(truth.get(img['id'], []))
        for r in found:
            best = max(open_truth, key=lambda t: iou(r['bbox'], t), default=None)
            if best is not None and iou(r['bbox'], best) >= IOU:
                open_truth.remove(best)
                real.append(r['confidence'])
            else:
                false.append(r['confidence'])
        real.extend(0.0 for _ in open_truth)
        if n % 50 == 0:
            print(f'{n}/{len(ann["images"])} photos')

    total = len(real)
    found_today = sum(c >= config.CONFIDENCE for c in real)
    rows, chosen = [], config.CONFIDENCE
    for bar in BARS:
        kept = sum(c >= bar for c in real)
        possible = sum(config.POSSIBLE_CONFIDENCE <= c < bar for c in real)
        alarms = sum(c >= bar for c in false)
        rows.append((bar, kept, possible, total - kept - possible, alarms))
        if kept >= KEEP * found_today:
            chosen = bar

    lines = [
        '# Glass: how sure must the model be? (CarDD test set)',
        '',
        f'Damage model `{config.MODEL_PATH.name}`, {len(ann["images"])} test photos, {total} real shattered-glass regions, '
        f'{len(false)} glass regions found where there is no shattered glass (false alarms, from 0.10 up).',
        f'A region counts as found when its box overlaps the real one by IoU >= {IOU}.',
        '',
        '| Bar | Real glass: finding | Real glass: possible damage | Real glass: missed | False alarms as findings |',
        '|---|---|---|---|---|',
    ]
    for bar, kept, possible, missed, alarms in rows:
        mark = ' **(chosen)**' if bar == chosen else ' (today)' if bar == config.CONFIDENCE else ''
        lines.append(f'| {bar:.2f}{mark} | {kept} ({kept / total:.0%}) | {possible} | {missed} | {alarms} of {len(false)} |')
    lines += [
        '',
        f'**Rule:** the highest bar that keeps at least {KEEP:.0%} of the real shattered glass that is a finding today '
        f'({found_today} regions at {config.CONFIDENCE:.2f}). Glass below the bar is not lost: it is shown as possible damage.',
        '',
        'Confidences of real glass (sorted): ' + ', '.join(f'{c:.2f}' for c in sorted(real)),
        '',
        'Confidences of false alarms (sorted): ' + ', '.join(f'{c:.2f}' for c in sorted(false)),
    ]
    out = HERE / 'results' / 'glass_threshold.md'
    out.parent.mkdir(exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
