r"""Evidence for the odd-sound check: runs the ACTIVE model's check (exactly as the service does) on
  - recordings that should be flagged: speech, music-like tone, beep, white/pink noise, silence-like hum
    (generated here; speech from --speech if given), and AI Mechanic's non-silent background-noise clips;
  - recordings that should pass: a sample of every training class, and AI Mechanic's in-cabin engine clips.
Writes results/familiarity.md.

Run:  ..\.venv\Scripts\python check_familiarity.py --data "C:\...\Vehicle Sound Inspection" [--speech speech.wav]
"""
import argparse
import csv
import os
from collections import defaultdict
from pathlib import Path

import joblib
import numpy as np

import audio
import learning
from features import panns_model, panns_outputs

HERE = Path(__file__).resolve().parent


def judge(fam, panns, x):
    w = audio.windows(x)
    emb, veh, oth = panns_outputs(panns, w)
    return fam.check(emb.mean(axis=0), float(veh.mean()), float(oth.mean()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.getenv('ACOUSTIC_DATA_DIR'))
    ap.add_argument('--speech', type=Path)
    ap.add_argument('--per-class', type=int, default=15)
    a = ap.parse_args()
    data = Path(a.data or '')
    fam = joblib.load(learning.active_path())['familiarity']
    panns = panns_model()
    rng = np.random.default_rng(0)
    sr, n = audio.SAMPLE_RATE, 6 * audio.SAMPLE_RATE
    t = np.arange(n) / sr

    odd = {
        'white noise': (0.1 * rng.standard_normal(n)).astype(np.float32),
        'pink noise': audio.add_noise(np.full(n, 1e-4, np.float32), -40, rng),
        'beep 1 kHz': (0.3 * np.sin(2 * np.pi * 1000 * t)).astype(np.float32),
        'beeping (on/off 2 Hz)': (0.3 * np.sin(2 * np.pi * 2000 * t) * (np.sin(2 * np.pi * 2 * t) > 0)).astype(np.float32),
        'chord (music-like)': (0.1 * sum(np.sin(2 * np.pi * f * t) for f in (261.6, 329.6, 392.0))).astype(np.float32),
    }
    if a.speech:
        odd['speech'] = audio.load(a.speech)
    for f in sorted((data / 'ai mechanic - engine condition audio fault finding' / 'ai-mechanic-export').glob('*/*ackground*.wav')):
        x = audio.load(f)
        if np.abs(x).max() > audio.SILENT_PEAK:
            odd[f'AI Mechanic {f.stem[:24]}'] = x[: 10 * sr]

    lines = ['# Odd-sound check: evidence', '', f'Model: {learning.active_path().parent.name} · thresholds: margin '
             f'{fam.margin_threshold:.3f}, distance {fam.distance_threshold:.2f}', '',
             '## Should be flagged', '', '| Recording | Vehicle | Speech/music/tone | Distance | Flagged |', '|---|---|---|---|---|']
    flagged = 0
    for name, x in odd.items():
        c = judge(fam, panns, x)
        flagged += not c['familiar']
        lines.append(f"| {name} | {c['vehicleScore']:.2f} | {c['otherScore']:.2f} | {c['distance']:.1f} | {'yes' if not c['familiar'] else '**no**'} |")
    lines += ['', f'{flagged} of {len(odd)} flagged.', '']

    with (HERE / 'data' / 'manifest.csv').open(encoding='utf-8') as fh:
        rows = [r for r in csv.DictReader(fh) if r['use'] == 'yes']
    by_class = defaultdict(list)
    for r in rows:
        by_class[(r['dataset'] == 'ai_mechanic', r['class'])].append(r)
    lines += ['## Should pass (real recordings)', '',
              f'Up to {a.per_class} recordings per class (these were in training, so this checks the rule does not flag '
              'real faults; the held-out rate is set by the 99th-percentile thresholds).', '',
              '| Class | Recordings | Flagged |', '|---|---|---|']
    total = wrong = 0
    for (external, cls), rs in sorted(by_class.items()):
        sample = [rs[i] for i in rng.choice(len(rs), min(a.per_class, len(rs)), replace=False)]
        k = sum(not judge(fam, panns, audio.load(data / r['path']))['familiar'] for r in sample)
        total += len(sample)
        wrong += k
        lines.append(f"| {cls}{' (AI Mechanic, in-cabin, never trained on)' if external else ''} | {len(sample)} | {k} |")
    lines += ['', f'{wrong} of {total} real recordings flagged ({wrong / max(total, 1):.1%}).']
    out = HERE / 'results' / 'familiarity.md'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
