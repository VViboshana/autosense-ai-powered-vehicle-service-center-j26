import io

import numpy as np
import pytest
import soundfile as sf

from app import sound
from app.sound import check_audio, classes, read_audio, summarise

SR = 16000


def tone(seconds, level=0.3, sr=SR):
    t = np.arange(int(seconds * sr)) / sr
    return (level * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def probs(**values):
    p = np.zeros(len(classes.CLASSES))
    for label, v in values.items():
        p[classes.CLASSES.index(label)] = v
    return p


def test_a_silent_recording_is_not_usable():
    q = check_audio(np.zeros(SR * 6, dtype=np.float32), SR)
    assert not q['usable'] and 'silent' in q['warnings'][0]


def test_a_recording_under_one_second_is_not_usable():
    q = check_audio(tone(0.5), SR)
    assert not q['usable'] and 'too short' in q['warnings'][0]


def test_a_short_but_usable_recording_gets_a_warning():
    q = check_audio(tone(3), SR)
    assert q['usable'] and not q['passed'] and 'Short recording' in q['warnings'][0]


def test_a_clean_six_second_recording_passes():
    q = check_audio(tone(6), SR)
    assert q['passed'] and q['usable'] and q['durationS'] == 6.0


def test_an_overloaded_microphone_is_reported():
    q = check_audio(np.clip(tone(6, level=3.0), -1, 1), SR)
    assert any('distorted' in w for w in q['warnings'])


def test_a_very_quiet_recording_is_reported():
    q = check_audio(tone(6, level=0.002), SR)
    assert q['usable'] and any('quiet' in w for w in q['warnings'])


def test_only_the_chosen_situations_classes_can_win():
    # worn_brakes is highest overall, but the technician said the engine was idling
    out = summarise(probs(worn_brakes=0.6, misfire=0.3, normal_idle=0.1), 'idling', 0.7)
    assert out['result']['label'] == 'misfire'
    assert out['result']['confidence'] == 0.75  # 0.3 / (0.3 + 0.1)
    assert [p['label'] for p in out['probabilities']][:2] == ['misfire', 'normal_idle']
    assert set(p['label'] for p in out['probabilities']) == set(classes.SITUATIONS['idling'])


def test_a_confident_fault_gives_its_name_and_advice():
    out = summarise(probs(worn_brakes=0.9, normal_brakes=0.1), 'braking', 0.7)['result']
    assert out['sure'] and not out['normal']
    assert out['message'] == 'Worn brakes. Inspect brake pads and discs.'


def test_a_low_confidence_answer_asks_to_record_again():
    out = summarise(probs(normal_start=0.4, bad_ignition=0.35, dead_battery=0.25), 'starting', 0.7)['result']
    assert out['label'] == 'normal_start' and not out['sure']
    assert out['message'].startswith('Not sure')


def test_a_normal_result_is_marked_normal():
    out = summarise(probs(normal_idle=0.95, low_oil=0.05), 'idling', 0.7)['result']
    assert out['normal'] and out['sure']


def test_a_wav_file_is_read_and_stereo_is_mixed_to_mono():
    buf = io.BytesIO()
    sf.write(buf, np.stack([tone(1), tone(1)], axis=1), SR, format='WAV')
    x, sr = read_audio(buf.getvalue())
    assert sr == SR and x.ndim == 1 and len(x) == SR


def test_a_file_that_is_not_audio_is_refused():
    with pytest.raises(ValueError):
        read_audio(b'this is not a recording')


def test_every_class_has_a_description():
    assert set(classes.DESCRIPTIONS) == set(classes.CLASSES)


def test_analyze_skips_the_model_when_the_recording_is_unusable():
    buf = io.BytesIO()
    sf.write(buf, np.zeros(SR * 6, dtype=np.float32), SR, format='WAV')
    out = sound.analyze(model=None, data=buf.getvalue(), situation='idling')  # model is never touched
    assert out['result'] is None and out['windows'] == 0
