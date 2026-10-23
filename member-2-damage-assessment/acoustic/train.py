r"""Step 3: compare the models fairly, choose one by a rule fixed in advance, train it on all data and save it.

Evaluation (5-fold grouped cross-validation): the clips are split into 5 parts; each part is the test set once while
the model trains on the other 4. "Grouped" = twins (pieces of one recording) always land in the same part, so the
model is never tested on a recording it already heard. Every clip is therefore tested exactly once.
A clip's answer: average the class probabilities of its 1.5 s windows (they "vote"), keep only the classes of the
clip's situation, pick the highest.
Each model is scored twice: on the clean test clips and on noisy copies of the same clips (workshop-like noise,
5-20 dB). Models marked "+ noise training" also learn from noisy copies of their training clips.
Choice rule (fixed before looking at results): the highest average of clean and noisy macro F1.
For comparison the chosen model is also scored with an ordinary (ungrouped) split, to show what twins would inflate.

Needs cache/features.npz and cache/features_noisy.npz (features.py, with and without --noisy-copies 2).
Writes results/results.md + results/results.json, and model/sound_classifier.joblib (git-ignored).
Run:  ..\.venv\Scripts\python train.py
"""
import csv
import json
from datetime import date
from pathlib import Path

import joblib
import numpy as np
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import audio
import classes

HERE = Path(__file__).resolve().parent
SEED = 42
VERSION = 'AutoSense Sound Inspection V1'
CONFIDENCE_LEVELS = [0.5, 0.6, 0.7, 0.8]

FOREST = RandomForestClassifier(n_estimators=400, class_weight='balanced', random_state=SEED, n_jobs=-1)
LOGISTIC = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=3000, class_weight='balanced'))
NEURAL = make_pipeline(StandardScaler(), MLPClassifier(hidden_layer_sizes=(256,), alpha=1e-2, early_stopping=True,
                                                       max_iter=300, random_state=SEED))
# key: (description, features, classifier, train on noisy copies too)
EXPERIMENTS = {
    'A': ('MFCC + random forest (classic baseline)', 'mfcc', FOREST, False),
    'B': ('PANNs + logistic regression', 'panns', LOGISTIC, False),
    'C': ('MFCC + PANNs + logistic regression', 'both', LOGISTIC, False),
    'D': ('PANNs + small neural network', 'panns', NEURAL, False),
    'E': ('PANNs + logistic regression + noise training', 'panns', LOGISTIC, True),
    'F': ('MFCC + PANNs + logistic regression + noise training', 'both', LOGISTIC, True),
    'G': ('PANNs + small neural network + noise training', 'panns', NEURAL, True),
}


def features(store, kind):
    return np.hstack([store['mfcc'], store['panns']]) if kind == 'both' else store[kind]


def clip_probs(model, x_win, clip_of, clip_ids, situations):
    """[len(clip_ids), n_classes]: window probabilities averaged per clip, other situations' classes set to 0."""
    p_win = np.zeros((len(x_win), len(classes.CLASSES)))
    p_win[:, model.classes_] = model.predict_proba(x_win)
    out = np.stack([p_win[clip_of == c].mean(0) for c in clip_ids])
    for k, s in enumerate(situations):
        mask = np.zeros(len(classes.CLASSES))
        mask[[classes.CLASSES.index(c) for c in classes.SITUATIONS[s]]] = 1
        out[k] *= mask
        total = out[k].sum()
        out[k] = out[k] / total if total > 0 else mask / mask.sum()  # no vote for any allowed class: all equal
    return out


def fit(model, clean, noisy, train_clips, y, use_noisy):
    """Train on the clean windows of train_clips (and their noisy copies if use_noisy)."""
    sets = [clean] + ([noisy] if use_noisy else [])
    x = np.vstack([s['x'][np.isin(s['clip'], train_clips)] for s in sets])
    labels = np.concatenate([y[s['clip'][np.isin(s['clip'], train_clips)]] for s in sets])
    return clone(model).fit(x, labels)


def cross_validate(model, clean, noisy, y, groups, situations, use_noisy, grouped=True):
    folds = (StratifiedGroupKFold(5, shuffle=True, random_state=SEED).split(y, y, groups) if grouped
             else StratifiedKFold(5, shuffle=True, random_state=SEED).split(y, y))
    p_clean, p_noisy = np.zeros((len(y), len(classes.CLASSES))), np.zeros((len(y), len(classes.CLASSES)))
    for train, test in folds:
        m = fit(model, clean, noisy, train, y, use_noisy)
        p_clean[test] = clip_probs(m, clean['x'], clean['clip'], test, situations[test])
        p_noisy[test] = clip_probs(m, noisy['x'], noisy['clip'], test, situations[test])
    return p_clean, p_noisy


def scores(y, probs, datasets):
    pred = probs.argmax(1)
    names = classes.CLASSES
    out = {'accuracy': accuracy_score(y, pred), 'macro_f1': f1_score(y, pred, average='macro'),
           'per_dataset': {d: accuracy_score(y[datasets == d], pred[datasets == d]) for d in np.unique(datasets)},
           'report': classification_report(y, pred, labels=range(len(names)), target_names=names,
                                           output_dict=True, zero_division=0),
           'confusion': confusion_matrix(y, pred, labels=range(len(names))).tolist(), 'confidence': []}
    conf = probs.max(1)
    for t in CONFIDENCE_LEVELS:
        sure = conf >= t
        out['confidence'].append({'threshold': t, 'answered': float(sure.mean()),
                                  'accuracy_when_answered': accuracy_score(y[sure], pred[sure]) if sure.any() else None})
    return out


def write_markdown(res, path):
    names = classes.CLASSES
    best = res['chosen']
    m, u = res['experiments'][best]['clean'], res['chosen_ungrouped']
    L = [f'# Sound inspection results ({res["date"]})', '',
         f'{res["clips"]} clips ({res["windows"]} windows of {audio.WINDOW_S} s) from {", ".join(res["datasets"])}; '
         '5-fold grouped cross-validation (each clip tested once, twins kept together). "Noisy" = the same test clips '
         'with workshop-like noise added (5-20 dB).', '',
         '| | Model | Clean acc. | Clean macro F1 | Noisy acc. | Noisy macro F1 | Car Diag. acc. | Sri Lanka acc. |',
         '|---|---|---|---|---|---|---|---|']
    for key, e in res['experiments'].items():
        c, n = e['clean'], e['noisy']
        mark = ' **(chosen)**' if key == best else ''
        L.append(f'| {key} | {e["name"]}{mark} | {c["accuracy"]:.3f} | {c["macro_f1"]:.3f} | {n["accuracy"]:.3f} | '
                 f'{n["macro_f1"]:.3f} | {c["per_dataset"].get("car_diagnostics", 0):.3f} | '
                 f'{c["per_dataset"].get("sri_lanka", 0):.3f} |')
    L += ['', 'Choice rule (fixed in advance): highest average of clean and noisy macro F1.', '',
          f'Chosen model with an ordinary (ungrouped) split: accuracy {u["accuracy"]:.3f}, macro F1 {u["macro_f1"]:.3f} '
          '-- the gap to the grouped score is how much twins would have inflated the result.', '',
          f'## Chosen model ({best}) per class, clean test', '',
          '| Class | Situation | Precision | Recall | F1 | Clips |', '|---|---|---|---|---|---|']
    for c in names:
        r = m['report'][c]
        L.append(f'| {c} | {classes.SITUATION_OF[c]} | {r["precision"]:.2f} | {r["recall"]:.2f} | {r["f1-score"]:.2f} | '
                 f'{int(r["support"])} |')
    L += ['', f'## Chosen model ({best}) confusion matrix, clean test (rows = true, columns = predicted)', '',
          '| true \\ pred | ' + ' | '.join(names) + ' |', '|---' * (len(names) + 1) + '|']
    for c, row in zip(names, m['confusion']):
        L.append(f'| {c} | ' + ' | '.join(str(v) if v else '.' for v in row) + ' |')
    L += ['', f'## Chosen model ({best}): answer only when confident (clean test)', '',
          '| Confidence at least | Clips answered | Accuracy on those |', '|---|---|---|']
    for c in m['confidence']:
        acc = f'{c["accuracy_when_answered"]:.3f}' if c['accuracy_when_answered'] is not None else '-'
        L.append(f'| {c["threshold"]:.1f} | {c["answered"]:.1%} | {acc} |')
    ext = res['external']
    if ext:
        L += ['', '## Recordings from another source (never used in training)', '',
              f'AI Mechanic normal-engine clips (recorded inside the cabin): {ext["correct"]} of {ext["clips"]} '
              f'called normal_idle; predictions: {ext["predictions"]}.']
    path.write_text('\n'.join(L) + '\n', encoding='utf-8')


def main():
    with (HERE / 'data' / 'manifest.csv').open(encoding='utf-8') as f:
        rows = {r['path']: r for r in csv.DictReader(f) if r['use'] == 'yes'}
    clean_npz, noisy_npz = np.load(HERE / 'cache' / 'features.npz'), np.load(HERE / 'cache' / 'features_noisy.npz')
    meta = [rows[p] for p in clean_npz['paths']]
    assert list(noisy_npz['paths']) == list(clean_npz['paths']), 'features.npz and features_noisy.npz differ: rebuild both'

    external = np.array([r['dataset'] == 'ai_mechanic' for r in meta])
    train_ids = np.where(~external)[0]
    y_all = np.array([classes.CLASSES.index(r['class']) for r in meta])
    situations_all = np.array([r['situation'] for r in meta])
    renumber = np.full(len(meta), -1)
    renumber[train_ids] = np.arange(len(train_ids))  # training clips become 0..n-1 so folds can index them directly

    def windows_of(npz, kind):
        keep = ~external[npz['clip_of']]
        return {'x': features(npz, kind)[keep], 'clip': renumber[npz['clip_of'][keep]]}

    y, sit = y_all[train_ids], situations_all[train_ids]
    groups = np.array([meta[i]['group'] for i in train_ids])
    datasets = np.array([meta[i]['dataset'] for i in train_ids])

    res = {'date': date.today().isoformat(), 'version': VERSION, 'clips': int(len(train_ids)),
           'windows': int((~external[clean_npz['clip_of']]).sum()), 'datasets': sorted(set(datasets)),
           'experiments': {}}
    for key, (name, kind, model, use_noisy) in EXPERIMENTS.items():
        clean, noisy = windows_of(clean_npz, kind), windows_of(noisy_npz, kind)
        p_clean, p_noisy = cross_validate(model, clean, noisy, y, groups, sit, use_noisy)
        e = res['experiments'][key] = {'name': name, 'clean': scores(y, p_clean, datasets),
                                       'noisy': scores(y, p_noisy, datasets)}
        print(f'{key} {name}: clean F1 {e["clean"]["macro_f1"]:.3f}, noisy F1 {e["noisy"]["macro_f1"]:.3f}')

    best = max(res['experiments'], key=lambda k: res['experiments'][k]['clean']['macro_f1']
               + res['experiments'][k]['noisy']['macro_f1'])
    res['chosen'] = best
    _, kind, model, use_noisy = EXPERIMENTS[best]
    clean, noisy = windows_of(clean_npz, kind), windows_of(noisy_npz, kind)
    res['chosen_ungrouped'] = scores(y, cross_validate(model, clean, noisy, y, groups, sit, use_noisy,
                                                       grouped=False)[0], datasets)
    print(f'Chosen {best}; ungrouped clean accuracy {res["chosen_ungrouped"]["accuracy"]:.3f}')

    final = fit(model, clean, noisy, np.arange(len(train_ids)), y, use_noisy)
    res['external'] = None
    ext_ids = np.where(external)[0]
    if len(ext_ids):
        x_all = features(clean_npz, kind)
        p = clip_probs(final, x_all, clean_npz['clip_of'], ext_ids, situations_all[ext_ids]).argmax(1)
        names = [classes.CLASSES[i] for i in p]
        res['external'] = {'clips': int(len(ext_ids)), 'correct': int((p == y_all[ext_ids]).sum()),
                           'predictions': {n: names.count(n) for n in sorted(set(names))}}

    (HERE / 'model').mkdir(exist_ok=True)
    joblib.dump({'model': final, 'classes': classes.CLASSES, 'situations': classes.SITUATIONS, 'features': kind,
                 'experiment': best, 'version': VERSION, 'sample_rate': audio.SAMPLE_RATE,
                 'window_s': audio.WINDOW_S, 'trained': res['date']}, HERE / 'model' / 'sound_classifier.joblib')
    (HERE / 'results').mkdir(exist_ok=True)
    (HERE / 'results' / 'results.json').write_text(json.dumps(res, indent=2), encoding='utf-8')
    write_markdown(res, HERE / 'results' / 'results.md')
    print('Wrote results/results.md and model/sound_classifier.joblib')


if __name__ == '__main__':
    main()
