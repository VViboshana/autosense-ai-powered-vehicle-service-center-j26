r"""Step 1: scan the sound datasets, clean them and write data/manifest.csv (one row per file: use it or why not).

Cleaning rules (each rejected file keeps its reason in the manifest):
  - synthetic mix        Car Diagnostics "combined" folder: files layered from single-fault clips, not real recordings
  - unmapped label       a label none of our classes covers (e.g. "air leak")
  - silent / too short   nothing to hear, or under 1 s
  - duplicate            an exact copy of a file already kept
  - conflicting labels   the same sound saved under two different labels: we cannot know which is right, so drop all
Groups: clips whose average spectrum is nearly identical (correlation > TWIN_CORR) are probably pieces of the same
recording. They get the same group, and the evaluation keeps a group entirely in training or entirely in testing.

Run:  ..\.venv\Scripts\python prepare.py --data "C:\\...\\Vehicle Sound Inspection"
"""
import argparse
import csv
import hashlib
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

import audio
import classes

HERE = Path(__file__).resolve().parent
TWIN_CORR = 0.995
MIN_SECONDS = 1.0

SOURCES = {  # dataset name -> (folder under --data, file pattern, label from path, label map)
    'car_diagnostics': ('Car Diagnostics Dataset', '**/*.wav', lambda p: p.parent.name, classes.CAR_DIAGNOSTICS),
    'sri_lanka': ('Sri Lanka Engine Sounds (HF)/MyDataSet', '*.wav',
                  lambda p: re.sub(r'_\d+$', '', p.stem), classes.SRI_LANKA),
    'ai_mechanic': ('ai mechanic - engine condition audio fault finding', '**/*.wav',
                    lambda p: p.name.split('.')[0].lower(), classes.AI_MECHANIC),
}


def fingerprint(x: np.ndarray) -> np.ndarray:
    """Average log spectrum, standardised: two pieces of the same recording give almost the same curve."""
    n = 1024
    frames = [np.abs(np.fft.rfft(x[i:i + n] * np.hanning(n))) for i in range(0, max(len(x) - n, 1), n // 2)]
    spec = np.log1p(np.mean(frames, axis=0))
    return (spec - spec.mean()) / (spec.std() + 1e-9)


def twin_groups(rows: list[dict], prints: list[np.ndarray], prefix: str) -> None:
    """Union-find over pairs of near-identical clips; sets row['group']."""
    parent = list(range(len(rows)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if rows:
        s = np.stack(prints)
        s /= np.linalg.norm(s, axis=1, keepdims=True)
        for i, j in zip(*np.where(np.triu(s @ s.T, 1) > TWIN_CORR)):
            parent[find(i)] = find(j)
    ids = {}
    for i, row in enumerate(rows):
        row['group'] = f'{prefix}-{ids.setdefault(find(i), len(ids)):04d}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.getenv('ACOUSTIC_DATA_DIR'), help='folder holding the downloaded datasets')
    data = Path(ap.parse_args().data or '')
    if not data.is_dir():
        raise SystemExit('Give the datasets folder with --data (or set ACOUSTIC_DATA_DIR).')

    all_rows = []
    for name, (folder, pattern, label_of, mapping) in SOURCES.items():
        files = sorted((data / folder).glob(pattern))
        rows, prints, seen = [], [], defaultdict(list)
        for path in files:
            source_label = label_of(path)
            row = {'path': path.relative_to(data).as_posix(), 'dataset': name, 'source_label': source_label,
                   'class': mapping.get(source_label, ''), 'situation': '', 'duration_s': '', 'group': '',
                   'use': 'no', 'reason': ''}
            all_rows.append(row)
            if 'combined' in path.parts:
                row['reason'] = 'synthetic mix'
                continue
            x = audio.load(path)
            row['duration_s'] = f'{len(x) / audio.SAMPLE_RATE:.2f}'
            if float(np.abs(x).max()) < audio.SILENT_PEAK:
                row['reason'] = 'silent'
            elif len(x) < MIN_SECONDS * audio.SAMPLE_RATE:
                row['reason'] = 'too short'
            elif not row['class']:
                row['reason'] = 'unmapped label'
            if row['reason']:
                continue
            seen[hashlib.md5(np.round(x, 4).tobytes()).hexdigest()].append((row, x))

        for copies in seen.values():
            if len({r['class'] for r, _ in copies}) > 1:
                for r, _ in copies:
                    r['reason'] = 'conflicting labels: ' + ' = '.join(Path(c['path']).name for c, _ in copies)
                continue
            keep, x = copies[0]
            for r, _ in copies[1:]:
                r['reason'] = f'duplicate of {Path(keep["path"]).name}'
            keep.update(use='yes', situation=classes.SITUATION_OF[keep['class']])
            rows.append(keep)
            prints.append(fingerprint(x))
        twin_groups(rows, prints, name)

    out = HERE / 'data' / 'manifest.csv'
    out.parent.mkdir(exist_ok=True)
    with out.open('w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0]))
        w.writeheader()
        w.writerows(all_rows)

    print(f'Wrote {out} ({len(all_rows)} files)')
    for name in SOURCES:
        rs = [r for r in all_rows if r['dataset'] == name]
        used = [r for r in rs if r['use'] == 'yes']
        reasons = Counter(r['reason'].split(':')[0].split(' of ')[0] for r in rs if r['use'] == 'no')
        multi = sum(1 for c in Counter(r['group'] for r in used).values() if c > 1)
        print(f'\n{name}: {len(used)} of {len(rs)} used, {len({r["group"] for r in used})} groups '
              f'({multi} with twins); rejected: {dict(reasons)}')
        for c, n in sorted(Counter(r['class'] for r in used).items()):
            print(f'  {c:16s} {n}')


if __name__ == '__main__':
    main()
