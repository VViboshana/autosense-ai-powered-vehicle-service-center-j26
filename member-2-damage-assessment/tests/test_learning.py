import io

import numpy as np
import pytest
import soundfile as sf

from app import sound, training
from app.sound import classes

import familiarity  # noqa: E402  (acoustic/ is on sys.path through app.sound)
import learning  # noqa: E402


def fitted():
    """A check fitted on random 'training' fingerprints: margin threshold 0.1, distance threshold = their 99th pct."""
    emb = np.random.default_rng(0).standard_normal((300, 64)).astype(np.float32)
    fam = familiarity.Familiarity().fit(emb, np.full(300, 0.1), distance_threshold=0)
    fam.distance_threshold = float(np.percentile(fam.distance(emb), 99))
    return fam, emb


def test_a_recording_like_the_training_ones_is_familiar():
    fam, emb = fitted()
    out = fam.check(emb[0], vehicle=0.5, other=0.05)
    assert out['familiar'] and out['reasons'] == []


def test_speech_louder_than_the_vehicle_is_flagged():
    fam, emb = fitted()
    out = fam.check(emb[0], vehicle=0.02, other=0.64)  # measured: Windows speech -> Speech 0.64, vehicle 0.02
    assert not out['familiar'] and 'speech' in out['reasons'][0]


def test_a_quiet_fault_with_little_vehicle_sound_is_not_flagged():
    # measured: a clicking flat battery scores ~0.01 "vehicle" - but nothing else is louder, so it is still judged
    fam, emb = fitted()
    assert fam.check(emb[0], vehicle=0.01, other=0.02)['familiar']


def test_a_fingerprint_far_from_training_is_flagged():
    fam, emb = fitted()
    out = fam.check(emb[0] * 25, vehicle=0.5, other=0.0)
    assert not out['familiar'] and 'unlike' in out['reasons'][0]


def test_the_margin_threshold_never_goes_below_a_floor():
    f = familiarity.Familiarity().fit(np.random.default_rng(1).standard_normal((100, 50)), np.full(100, -0.9), 5.0)
    assert f.margin_threshold == 0.05


class FakeModel:
    """Stands in for SoundModel: fixed probabilities and odd-sound result, no PANNs."""

    def __init__(self, check):
        self.check = check

    def analyse(self, wins):
        p = np.zeros(len(classes.CLASSES))
        p[classes.CLASSES.index('misfire')] = 0.95
        p[classes.CLASSES.index('normal_idle')] = 0.05
        return p, self.check


def wav(seconds=6.0, sr=16000):
    t = np.arange(int(seconds * sr)) / sr
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 120 * t)).astype(np.float32), sr, format='WAV')
    return buf.getvalue()


def test_an_unfamiliar_recording_is_answered_but_never_sure():
    check = {'familiar': False, 'reasons': ['it sounds more like speech, music or a tone than a vehicle']}
    out = sound.analyze(FakeModel(check), wav(), 'idling')
    assert out['result']['label'] == 'misfire' and out['result']['confidence'] == 0.95
    assert out['result']['sure'] is False and out['result']['familiar'] is False
    assert out['quality']['passed'] is False and 'engine-bay' in out['quality']['warnings'][-1]


def test_a_familiar_confident_recording_stays_sure():
    out = sound.analyze(FakeModel({'familiar': True, 'reasons': []}), wav(), 'idling')
    assert out['result']['sure'] is True and out['result']['familiar'] is True


def test_retraining_refuses_a_fault_from_another_situation():
    with pytest.raises(ValueError, match='not a idling fault'):
        training.start([('a.wav', b'x')], [{'file': 'a.wav', 'label': 'worn_brakes', 'situation': 'idling', 'group': 'g'}])


def test_retraining_refuses_a_manifest_naming_a_missing_recording():
    with pytest.raises(ValueError, match='No recording named'):
        training.start([('a.wav', b'x')], [{'file': 'b.wav', 'label': 'misfire', 'situation': 'idling', 'group': 'g'}])


def test_activating_a_missing_version_fails_without_changing_the_active_one(tmp_path, monkeypatch):
    monkeypatch.setattr(learning, 'VERSIONS_DIR', tmp_path / 'versions')
    monkeypatch.setattr(learning, 'ACTIVE_FILE', tmp_path / 'active.json')
    with pytest.raises(FileNotFoundError):
        learning.set_active(7)
    assert not (tmp_path / 'active.json').exists()
    assert learning.active_version() == 1
