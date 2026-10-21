import importlib.util

import cv2
import numpy as np
import pytest

from app.plates import MAX_READS, PlateVotes, plate_core
from app.pipeline import process_video
from app.state_machine import Rules
from test_pipeline import BAY, BlobDetector, make_video


@pytest.mark.parametrize('text, expected', [
    ('WPKP-0683', ('KP0683', 'WP KP-0683')),
    ('WP KP 0683', ('KP0683', 'WP KP-0683')),
    ('KP-0683', ('KP0683', 'KP-0683')),
    ('wp cab-4521', ('CAB4521', 'WP CAB-4521')),
    ('CAB 4521', ('CAB4521', 'CAB-4521')),
    ('19-1234', ('191234', '19-1234')),
    ('250-1234', ('2501234', '250-1234')),
])
def test_sri_lankan_plates_are_reduced_to_their_core(text, expected):
    assert plate_core(text) == expected


@pytest.mark.parametrize('text', ['HONDA', 'KP-068', '0683', 'ABCD-1234', ''])
def test_text_that_is_not_a_plate_is_ignored(text):
    assert plate_core(text) is None


def test_a_plate_counts_only_when_readings_agree():
    v = PlateVotes()
    v.add(('KP0683', 'WP KP-0683', 0.99))
    v.add(('KP0583', 'KP-0583', 0.74))            # one misreading
    assert not v.stable
    v.add(('KP0683', 'KP-0683', 0.98))
    v.add(None)                                   # nothing readable in this frame
    v.add(('KP0683', 'WP KP-0683', 0.97))
    view = v.view()
    assert v.stable and view['core'] == 'KP0683' and view['text'] == 'WP KP-0683' and view['votes'] == 3
    assert view['reads'] == 5 and view['done']


def test_reading_stops_after_enough_attempts_even_without_agreement():
    v = PlateVotes()
    for i in range(MAX_READS):
        v.add((f'KP{1000 + i}', f'KP-{1000 + i}', 0.9))
    assert not v.stable and v.done


class FakePlates:
    """Stands in for the OCR: every vehicle has plate WP KP-0683."""
    def __init__(self):
        self.calls = 0

    def read(self, frame, bbox):
        self.calls += 1
        return ('KP0683', 'WP KP-0683', 0.95)


def test_the_parked_vehicles_plate_is_read_until_settled_and_forgotten_when_it_leaves(tmp_path):
    video = make_video(tmp_path / 'park.avi', 16, lambda t: 85 if 2 <= t < 9 else None)
    plates, seen = FakePlates(), []
    states = []
    process_video(video, [BAY], BlobDetector(), Rules(), sample_fps=2, plates=plates,
                  on_progress=lambda p: states.append(dict(p.states['B1'])))
    plated = [s['plate'] for s in states if s.get('plate')]
    assert plated and plated[-1]['core'] == 'KP0683' and plated[-1]['stable']
    assert plates.calls == 3                       # stops reading once three readings agree
    assert states[-1]['state'] == 'free' and states[-1]['plate'] is None   # forgotten after the car left


def test_no_plate_reading_without_a_reader(tmp_path):
    video = make_video(tmp_path / 'park.avi', 8, lambda t: 85)
    progress = process_video(video, [BAY], BlobDetector(), Rules(), sample_fps=2)
    assert progress.states['B1']['plate'] is None


@pytest.mark.skipif(importlib.util.find_spec('rapidocr_onnxruntime') is None, reason='OCR package not installed')
def test_the_real_reader_reads_a_clear_plate():
    from app.plates import PlateReader
    img = np.full((400, 640, 3), 230, np.uint8)
    cv2.rectangle(img, (170, 230), (470, 300), (255, 255, 255), -1)
    cv2.rectangle(img, (170, 230), (470, 300), (0, 0, 0), 3)
    cv2.putText(img, 'KP-0683', (195, 285), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 0), 4, cv2.LINE_AA)
    reading = PlateReader().read(img, (100, 100, 540, 380))
    assert reading is not None and reading[0] == 'KP0683'
