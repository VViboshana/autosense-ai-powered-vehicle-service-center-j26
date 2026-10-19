from compare_truth import score, state_at

TRUTH = {'holdSeconds': 6, 'frames': ['a', 'b', 'c'], 'times': ['11:00', '11:05', '11:10'],
         'bays': {'1': [[0, 0], [1, 0], [1, 1]]}, 'truth': {'1': [1, 1, 0]}}


def test_state_is_the_last_transition_before_the_time():
    tr = [{'bayId': '1', 'toState': 'free', 'atSeconds': 10.0}, {'bayId': '1', 'toState': 'occupied', 'atSeconds': 3.0}]
    assert state_at(tr, '1', 2.9) == 'uncertain'
    assert state_at(tr, '1', 3.0) == 'occupied' and state_at(tr, '1', 12) == 'free'


def test_each_image_is_scored_at_the_end_of_its_hold():
    # occupied confirmed at 3 s, free confirmed at 17 s: the third image (12-18 s) ends free
    tr = [{'bayId': '1', 'toState': 'occupied', 'atSeconds': 3.0}, {'bayId': '1', 'toState': 'free', 'atSeconds': 17.0}]
    assert score(TRUTH, tr)['matched'] == 3
    # free only confirmed after the third image ended -> that image is a mismatch
    late = [tr[0], {'bayId': '1', 'toState': 'free', 'atSeconds': 18.5}]
    r = score(TRUTH, late)
    assert (r['matched'], r['total']) == (2, 3) and r['mismatches'][0]['got'] == 'occupied'
    assert score(TRUTH, [])['confusion'] == {'free->uncertain': 1, 'occupied->uncertain': 2}
