r"""Step 2: turn every used clip into features, one row per 1.5 s window, saved to cache/features.npz.

Two kinds of features, one per model we compare:
  - mfcc: 20 MFCCs (a compact description of the sound's tone colour) and how they change, as mean and spread
          over the window -> 80 numbers. The classic hand-made features (baseline).
  - panns: the 2048-number "sound fingerprint" from PANNs CNN14, a network pre-trained on AudioSet (about 2 million
           YouTube clips, 527 everyday sound types). It already knows what engines, squeals and clicks sound like.
  - vehicle / other: per window, how strongly PANNs hears vehicle sound and speech/music/tones (familiarity.py).

With --noisy-copies K it instead writes cache/features_noisy.npz: K copies of every clip with workshop-like noise
added (random 5-20 dB signal-to-noise), used to train on noise and to test how well each model copes with it.

Run:  ..\.venv\Scripts\python features.py --data "C:\...\Vehicle Sound Inspection" [--noisy-copies 2]
(About 8 minutes per pass on a CPU. PANNs files must be in ~/panns_data first: run download_panns.py once.)
"""
import argparse
import csv
import os
from pathlib import Path

import librosa
import numpy as np

import audio
import familiarity

HERE = Path(__file__).resolve().parent
BATCH = 32


def mfcc_features(w: np.ndarray) -> np.ndarray:
    m = librosa.feature.mfcc(y=w, sr=audio.SAMPLE_RATE, n_mfcc=20)
    d = librosa.feature.delta(m)
    return np.concatenate([m.mean(1), m.std(1), d.mean(1), d.std(1)])


def panns_model():
    from panns_inference import AudioTagging  # imported here: it prints and loads 300 MB, only needed when used
    return AudioTagging(checkpoint_path=None, device='cpu')


def panns_features(model, wins: np.ndarray) -> np.ndarray:
    return panns_outputs(model, wins)[0]


def panns_outputs(model, wins: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(fingerprints [n, 2048], vehicle [n], other [n]): PANNs' embedding, and how strongly it hears vehicle sound and
    "something else" (speech, music, a tone; see familiarity.py)."""
    from panns_inference.config import labels
    veh_i = familiarity.label_indices(labels, familiarity.VEHICLE_LABELS)
    oth_i = familiarity.label_indices(labels, familiarity.OTHER_LABELS)
    emb, vehicle, other = [], [], []
    for i in range(0, len(wins), BATCH):
        tags, e = model.inference(wins[i:i + BATCH])
        emb.append(e)
        vehicle.append(familiarity.strongest(tags, veh_i))
        other.append(familiarity.strongest(tags, oth_i))
    cat = lambda xs: np.concatenate(xs).astype(np.float32)
    return cat(emb), cat(vehicle), cat(other)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default=os.getenv('ACOUSTIC_DATA_DIR'))
    ap.add_argument('--noisy-copies', type=int, default=0)
    args = ap.parse_args()
    data = Path(args.data or '')
    if not data.is_dir():
        raise SystemExit('Give the datasets folder with --data (or set ACOUSTIC_DATA_DIR).')

    with (HERE / 'data' / 'manifest.csv').open(encoding='utf-8') as f:
        rows = [r for r in csv.DictReader(f) if r['use'] == 'yes']

    rng = np.random.default_rng(42)
    clip_of, snr, wins = [], [], []
    for i, r in enumerate(rows):
        x = audio.load(data / r['path'])
        for _ in range(max(args.noisy_copies, 1)):
            level = rng.uniform(5, 20) if args.noisy_copies else np.inf
            w = audio.windows(audio.add_noise(x, level, rng) if args.noisy_copies else x)
            wins.append(w)
            clip_of += [i] * len(w)
            snr += [level] * len(w)
    wins = np.concatenate(wins)
    print(f'{len(rows)} clips -> {len(wins)} windows')

    mfcc = np.stack([mfcc_features(w) for w in wins]).astype(np.float32)
    panns, vehicle, other = panns_outputs(panns_model(), wins)

    out = HERE / 'cache' / ('features_noisy.npz' if args.noisy_copies else 'features.npz')
    out.parent.mkdir(exist_ok=True)
    np.savez_compressed(out, paths=np.array([r['path'] for r in rows]), clip_of=np.array(clip_of),
                        snr_db=np.array(snr, dtype=np.float32), mfcc=mfcc, panns=panns, vehicle=vehicle, other=other)
    print(f'Wrote {out}: mfcc {mfcc.shape}, panns {panns.shape}')


if __name__ == '__main__':
    main()
