"""Sound inspection: a short recording + the situation (starting / idling / braking) -> the most likely fault.

Uses the classifier trained in acoustic/ (train.py) and the same audio preparation (acoustic/audio.py), so the service
hears a recording exactly the way the model was trained and tested.
"""
import io
import sys

import numpy as np
import soundfile as sf

from . import config

sys.path.insert(0, str(config.ACOUSTIC_DIR))  # acoustic/ is the training folder, not part of this package
import audio  # noqa: E402
import classes  # noqa: E402


class SoundModel:
    """Loaded once at startup: the trained classifier (KB) and, for its features, PANNs CNN14 (~330 MB)."""

    def __init__(self, path):
        import joblib
        from features import mfcc_features, panns_features, panns_model

        self.bundle = joblib.load(path)
        self.kind = self.bundle['features']
        self._mfcc, self._panns_features = mfcc_features, panns_features
        self._panns = panns_model() if self.kind in ('panns', 'both') else None

    @property
    def info(self) -> dict:
        b = self.bundle
        return {'version': b['version'], 'experiment': b['experiment'], 'trained': b['trained']}

    def probabilities(self, wins: np.ndarray) -> np.ndarray:
        """Average class probabilities over the windows, in classes.CLASSES order (same features as train.py)."""
        parts = []
        if self.kind in ('mfcc', 'both'):
            parts.append(np.stack([self._mfcc(w) for w in wins]))
        if self.kind in ('panns', 'both'):
            parts.append(self._panns_features(self._panns, wins))
        model = self.bundle['model']
        p = np.zeros((len(wins), len(classes.CLASSES)))
        p[:, model.classes_] = model.predict_proba(np.hstack(parts))
        return p.mean(axis=0)


def read_audio(data: bytes) -> tuple[np.ndarray, int]:
    """Mono samples and sample rate. ValueError if the file is not audio soundfile can read (WAV, FLAC, OGG)."""
    try:
        x, sr = sf.read(io.BytesIO(data), dtype='float32', always_2d=True)
    except (sf.LibsndfileError, RuntimeError, TypeError) as e:
        raise ValueError('The file is not a readable recording (use WAV, FLAC or OGG).') from e
    return x.mean(axis=1), sr


def check_audio(x: np.ndarray, sr: int) -> dict:
    """Before the model, like the photo quality check. usable=False means no prediction is made."""
    seconds = len(x) / sr if sr else 0.0
    peak = float(np.abs(x).max()) if len(x) else 0.0
    rms = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0.0
    clipped = float(np.mean(np.abs(x) >= 0.99)) if len(x) else 0.0

    warnings, usable = [], True
    if peak < audio.SILENT_PEAK:
        warnings.append('The recording is silent; check the microphone and record again.')
        usable = False
    elif seconds < config.SOUND_MIN_SECONDS:
        warnings.append(f'The recording is too short ({seconds:.1f} s); record {config.SOUND_GOOD_SECONDS:.0f}-10 s.')
        usable = False
    else:
        if seconds < config.SOUND_GOOD_SECONDS:
            warnings.append(f'Short recording ({seconds:.1f} s); {config.SOUND_GOOD_SECONDS:.0f}-10 s gives a more '
                            'reliable answer.')
        if clipped > config.SOUND_CLIPPED_MAX:
            warnings.append('The sound is distorted (too loud for the microphone); hold the phone a little further away.')
        if rms < config.SOUND_QUIET_RMS:
            warnings.append('The sound is very quiet; open the bonnet and hold the phone about 30 cm from the engine.')
    return {'passed': not warnings, 'usable': usable, 'durationS': round(seconds, 2), 'clippedRatio': round(clipped, 4),
            'rms': round(rms, 4), 'warnings': warnings}


def summarise(probs: np.ndarray, situation: str, sure_confidence: float) -> dict:
    """Keep only the situation's classes, renormalise, and describe the top one."""
    allowed = classes.SITUATIONS[situation]
    p = np.array([probs[classes.CLASSES.index(c)] for c in allowed])
    p = p / p.sum() if p.sum() > 0 else np.full(len(allowed), 1 / len(allowed))
    order = np.argsort(-p)
    label, confidence = allowed[order[0]], float(p[order[0]])
    name, advice = classes.DESCRIPTIONS[label]
    sure = confidence >= sure_confidence
    if not sure:
        message = 'Not sure: record again closer to the engine, or check by ear.'
    elif label in classes.NORMAL:
        message = advice
    else:
        message = f'{name}. {advice}'
    return {
        'result': {'label': label, 'name': name, 'confidence': round(confidence, 3), 'normal': label in classes.NORMAL,
                   'sure': sure, 'advice': advice, 'message': message},
        'probabilities': [{'label': allowed[i], 'name': classes.DESCRIPTIONS[allowed[i]][0],
                           'probability': round(float(p[i]), 3)} for i in order],
    }


def analyze(model: SoundModel, data: bytes, situation: str) -> dict:
    x, sr = read_audio(data)
    quality = check_audio(x, sr)
    out = {'situation': situation, 'quality': quality, 'windows': 0, 'result': None, 'probabilities': []}
    if quality['usable']:
        wins = audio.windows(audio.prepare(x, sr))
        out['windows'] = len(wins)
        out.update(summarise(model.probabilities(wins), situation, config.SOUND_SURE_CONFIDENCE))
    return out
