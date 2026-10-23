"""The sound model's learning loop: the chosen recipe (experiment F), training data from the datasets plus the
recordings technicians confirmed in the app, a fair comparison, and versioned models.

Recipe F (chosen in train.py): MFCC + PANNs features, logistic regression, trained on clean and noisy copies.

Model versions live in model/versions/<n>/ (sound_classifier.joblib + report.json); model/active.json names the one
the service uses. Version 1 is the model train.py made (model/sound_classifier.joblib). A new version is never active
until someone activates it, and the previous one stays for rolling back.
"""
import json
from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import audio
import classes
import familiarity

HERE = Path(__file__).resolve().parent
MODEL_DIR = HERE / 'model'
VERSIONS_DIR = MODEL_DIR / 'versions'
ACTIVE_FILE = MODEL_DIR / 'active.json'
V1_PATH = MODEL_DIR / 'sound_classifier.joblib'
SEED = 42
NAME = 'AutoSense Sound Inspection'
RECIPE = 'F: MFCC + PANNs, logistic regression, noise training'
MODEL = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=3000, class_weight='balanced'))
NOISY_COPIES = 2


@dataclass
class Data:
    """Clips and their windows. Windows point at clips by index (clip_clean / clip_noisy)."""
    y: np.ndarray            # class index per clip
    situation: np.ndarray    # per clip
    group: np.ndarray        # twins / same vehicle share a group (never split between training and testing)
    dataset: np.ndarray      # car_diagnostics | sri_lanka | app
    x_clean: np.ndarray      # [windows, 80 MFCC + 2048 PANNs]
    clip_clean: np.ndarray
    x_noisy: np.ndarray
    clip_noisy: np.ndarray
    emb: np.ndarray = field(default=None)       # clip fingerprints (mean PANNs), clean then noisy copies, for familiarity
    veh: np.ndarray = field(default=None)       # clip vehicle scores, same order as emb
    oth: np.ndarray = field(default=None)       # clip "speech/music/tone" scores, same order as emb

    @property
    def clips(self):
        return len(self.y)


def _features(npz):
    return np.hstack([npz['mfcc'], npz['panns']])


def _clip_means(values, clip_of, n):
    return np.stack([values[clip_of == i].mean(0) for i in range(n)])


def dataset_data(manifest_rows: dict, clean_npz, noisy_npz) -> Data:
    """The datasets' clips from the features cache (no audio is read). AI Mechanic stays out: it is a test source."""
    meta = [manifest_rows[p] for p in clean_npz['paths']]
    keep = np.array([m['dataset'] != 'ai_mechanic' for m in meta])
    ids = np.where(keep)[0]
    renumber = np.full(len(meta), -1)
    renumber[ids] = np.arange(len(ids))

    def part(npz):
        w = keep[npz['clip_of']]
        return _features(npz)[w], renumber[npz['clip_of'][w]], npz['panns'][w], npz['vehicle'][w], npz['other'][w]

    xc, cc, pc, vc, oc = part(clean_npz)
    xn, cn, pn, vn, on = part(noisy_npz)
    n = len(ids)
    return Data(
        y=np.array([classes.CLASSES.index(meta[i]['class']) for i in ids]),
        situation=np.array([meta[i]['situation'] for i in ids]),
        group=np.array([meta[i]['group'] for i in ids]),
        dataset=np.array([meta[i]['dataset'] for i in ids]),
        x_clean=xc, clip_clean=cc, x_noisy=xn, clip_noisy=cn,
        emb=np.vstack([_clip_means(pc, cc, n), _clip_means(pn, cn, n)]),
        veh=np.concatenate([_clip_means(vc, cc, n), _clip_means(vn, cn, n)]),
        oth=np.concatenate([_clip_means(oc, cc, n), _clip_means(on, cn, n)]),
    )


def app_data(recordings: list[dict], panns, progress=lambda done, total: None) -> Data:
    """Technician-confirmed app recordings ({path, label, situation, group}): read, windowed and fingerprinted like
    the datasets (clean + NOISY_COPIES noisy copies)."""
    from features import mfcc_features, panns_outputs

    rng = np.random.default_rng(SEED)
    y, sit, grp = [], [], []
    parts = {'clean': ([], [], [], [], []), 'noisy': ([], [], [], [], [])}
    for i, r in enumerate(recordings):
        x = audio.load(r['path'])
        y.append(classes.CLASSES.index(r['label']))
        sit.append(r['situation'])
        grp.append(r['group'])
        for kind, copies in (('clean', [None]), ('noisy', [rng.uniform(5, 20) for _ in range(NOISY_COPIES)])):
            for snr in copies:
                w = audio.windows(x if snr is None else audio.add_noise(x, snr, rng))
                emb, veh, oth = panns_outputs(panns, w)
                mfcc = np.stack([mfcc_features(v) for v in w])
                xs, clips, embs, vehs, oths = parts[kind]
                xs.append(np.hstack([mfcc, emb]))
                clips.append(np.full(len(w), i))
                embs.append(emb)
                vehs.append(veh)
                oths.append(oth)
        progress(i + 1, len(recordings))
    n = len(recordings)
    cat = lambda kind, k: np.concatenate(parts[kind][k]) if n else np.zeros((0,))
    return Data(
        y=np.array(y, dtype=int), situation=np.array(sit), group=np.array(grp), dataset=np.array(['app'] * n),
        x_clean=cat('clean', 0), clip_clean=cat('clean', 1).astype(int), x_noisy=cat('noisy', 0), clip_noisy=cat('noisy', 1).astype(int),
        emb=np.vstack([_clip_means(cat('clean', 2), cat('clean', 1), n), _clip_means(cat('noisy', 2), cat('noisy', 1), n)]) if n else None,
        veh=np.concatenate([_clip_means(cat('clean', 3), cat('clean', 1), n), _clip_means(cat('noisy', 3), cat('noisy', 1), n)]) if n else None,
        oth=np.concatenate([_clip_means(cat('clean', 4), cat('clean', 1), n), _clip_means(cat('noisy', 4), cat('noisy', 1), n)]) if n else None,
    )


def combine(a: Data, b: Data) -> Data:
    if b.clips == 0:
        return a
    off = a.clips
    half = lambda d, arr: (arr[:d.clips], arr[d.clips:])  # emb/veh: clean clips then noisy copies
    ae, an = half(a, a.emb)
    be, bn = half(b, b.emb)
    av, anv = half(a, a.veh)
    bv, bnv = half(b, b.veh)
    ao, ano = half(a, a.oth)
    bo, bno = half(b, b.oth)
    return Data(
        y=np.concatenate([a.y, b.y]), situation=np.concatenate([a.situation, b.situation]),
        group=np.concatenate([a.group, b.group]), dataset=np.concatenate([a.dataset, b.dataset]),
        x_clean=np.vstack([a.x_clean, b.x_clean]), clip_clean=np.concatenate([a.clip_clean, b.clip_clean + off]),
        x_noisy=np.vstack([a.x_noisy, b.x_noisy]), clip_noisy=np.concatenate([a.clip_noisy, b.clip_noisy + off]),
        emb=np.vstack([ae, be, an, bn]), veh=np.concatenate([av, bv, anv, bnv]), oth=np.concatenate([ao, bo, ano, bno]),
    )


def fit(d: Data, clips: np.ndarray):
    """Recipe F on the given clips: their clean windows plus their noisy copies."""
    wc, wn = np.isin(d.clip_clean, clips), np.isin(d.clip_noisy, clips)
    x = np.vstack([d.x_clean[wc], d.x_noisy[wn]])
    y = np.concatenate([d.y[d.clip_clean[wc]], d.y[d.clip_noisy[wn]]])
    return clone(MODEL).fit(x, y)


def clip_probs(model, x_win, clip_of, clip_ids, situations):
    """Window probabilities averaged per clip, then only the clip's situation's classes (renormalised)."""
    p_win = np.zeros((len(x_win), len(classes.CLASSES)))
    p_win[:, model.classes_] = model.predict_proba(x_win)
    out = np.zeros((len(clip_ids), len(classes.CLASSES)))
    for k, (c, s) in enumerate(zip(clip_ids, situations)):
        mask = np.zeros(len(classes.CLASSES))
        mask[[classes.CLASSES.index(x) for x in classes.SITUATIONS[s]]] = 1
        p = p_win[clip_of == c].mean(0) * mask
        out[k] = p / p.sum() if p.sum() > 0 else mask / mask.sum()
    return out


def _score(y, p, subset=None):
    if subset is not None:
        y, p = y[subset], p[subset]
    if len(y) == 0:
        return None
    pred = p.argmax(1)
    return {'clips': int(len(y)), 'accuracy': round(float(accuracy_score(y, pred)), 4),
            'macroF1': round(float(f1_score(y, pred, average='macro')), 4)}


def compare(d: Data, progress=lambda done, total: None) -> dict:
    """Fair comparison on the same 5 grouped folds: 'current' = recipe F trained WITHOUT the app recordings (what the
    active model knows), 'new' = trained WITH them. Both are tested on every clip once, clean and noisy."""
    folds = list(StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(d.y, d.y, d.group))
    app = d.dataset == 'app'
    probs = {k: np.zeros((d.clips, len(classes.CLASSES))) for k in ('current_clean', 'current_noisy', 'new_clean', 'new_noisy')}
    for n, (train, test) in enumerate(folds):
        for name, clips in (('current', train[~app[train]]), ('new', train)):
            m = fit(d, clips)
            probs[f'{name}_clean'][test] = clip_probs(m, d.x_clean, d.clip_clean, test, d.situation[test])
            probs[f'{name}_noisy'][test] = clip_probs(m, d.x_noisy, d.clip_noisy, test, d.situation[test])
        progress(n + 1, len(folds))
    out = {}
    for name in ('current', 'new'):
        c, z = probs[f'{name}_clean'], probs[f'{name}_noisy']
        out[name] = {'all': _score(d.y, c), 'noisy': _score(d.y, z), 'appRecordings': _score(d.y, c, app)}
    return out


def fit_familiarity(d: Data) -> familiarity.Familiarity:
    """Distance threshold from honest held-out distances (each clip scored by a check that never saw it)."""
    n = d.clips
    held = np.zeros(2 * n)
    for train, test in StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(d.y, d.y, d.group):
        f = familiarity.Familiarity().fit(np.vstack([d.emb[train], d.emb[n + train]]), np.zeros(0), 0)
        held[test] = f.distance(d.emb[test])
        held[n + test] = f.distance(d.emb[n + test])
    threshold = float(np.percentile(held, familiarity.DISTANCE_PERCENTILE))
    return familiarity.Familiarity().fit(d.emb, d.oth - d.veh, threshold)


def bundle(model, fam, version: int, trained: str, trained_on: dict) -> dict:
    return {'model': model, 'familiarity': fam, 'classes': classes.CLASSES, 'situations': classes.SITUATIONS,
            'features': 'both', 'experiment': 'F', 'version': f'{NAME} V{version}', 'versionNo': version,
            'sample_rate': audio.SAMPLE_RATE, 'window_s': audio.WINDOW_S, 'trained': trained, 'trainedOn': trained_on}


def trained_on(d: Data) -> dict:
    return {str(k): int(v) for k, v in zip(*np.unique(d.dataset, return_counts=True))}


# ---------- versions ----------

def versions() -> list[dict]:
    """Every saved version's report, newest first (version 1 = train.py's model, when it exists)."""
    out = []
    for f in VERSIONS_DIR.glob('*/report.json'):
        out.append(json.loads(f.read_text(encoding='utf-8')))
    return sorted(out, key=lambda r: -r['versionNo'])


def version_path(version_no: int) -> Path:
    return VERSIONS_DIR / str(version_no) / 'sound_classifier.joblib'


def active_version() -> int:
    if ACTIVE_FILE.exists():
        return int(json.loads(ACTIVE_FILE.read_text(encoding='utf-8'))['versionNo'])
    return 1


def active_path() -> Path:
    n = active_version()
    p = version_path(n)
    return p if p.exists() else V1_PATH


def set_active(version_no: int):
    if not version_path(version_no).exists():
        raise FileNotFoundError(f'Sound model version {version_no} does not exist.')
    ACTIVE_FILE.write_text(json.dumps({'versionNo': version_no}), encoding='utf-8')


def next_version() -> int:
    return max([1] + [r['versionNo'] for r in versions()]) + 1
