import numpy as np

from simulate_bays import FPS, bay_from_box, timeline


def test_bay_outline_is_the_parked_car_box_shrunk_and_normalised():
    assert bay_from_box((100, 50, 300, 150), 400, 200) == [[0.29, 0.29], [0.71, 0.29], [0.71, 0.71], [0.29, 0.71]]


def test_each_bay_cycles_empty_arrive_parked_leave():
    frames = [np.zeros((36, 64, 3), np.uint8)] * 120          # a 5 s clip at 24 fps
    seq, states = timeline(frames, 24, 300, seed=1)
    assert len(seq) == len(states) == 300 * FPS
    runs = []
    for s in states:
        if not runs or runs[-1][0] != s:
            runs.append([s, 0])
        runs[-1][1] += 1
    order = [r[0] for r in runs]
    assert order[:5] == [0, None, 1, None, 0]                  # empty -> moving -> parked -> moving -> empty
    assert all(n >= 20 * FPS for s, n in runs[1:-1] if s == 0)  # holds long enough for the 3 s / 5 s confirmations
    assert all(n >= 30 * FPS for s, n in runs[:-1] if s == 1)
