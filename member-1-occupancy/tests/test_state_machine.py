import pytest

from app.state_machine import BayTracker, Rules

FPS = 2  # the default sample rate (occupancy.rules.sampleFps)


def feed(bay: BayTracker, scores, start=0.0, track_id=7):
    """Feeds one score per sample at 2 fps; returns the transitions produced."""
    out = []
    for i, s in enumerate(scores):
        tr = bay.observe(start + i / FPS, s, track_id)
        if tr:
            out.append(tr)
    return out


def settled(state: str) -> BayTracker:
    bay = BayTracker('B1')
    feed(bay, [0.9 if state == 'occupied' else 0.0] * 20)
    assert bay.state == state
    return bay


def test_starts_uncertain_and_confirms_the_first_state():
    bay = BayTracker('B1')
    assert bay.state == 'uncertain'
    trs = feed(bay, [0.0] * 11)                      # 0..5 s of absence
    assert [(t.from_state, t.to_state, t.at) for t in trs] == [('uncertain', 'free', 5.0)]


def test_car_parking_is_committed_after_three_seconds_with_its_track_and_evidence():
    bay = settled('free')
    trs = feed(bay, [0.8] * 8, start=20.0, track_id=42)
    assert len(trs) == 1
    t = trs[0]
    assert (t.from_state, t.to_state, t.at, t.track_id, t.overlap) == ('free', 'occupied', 23.0, 42, 0.8)
    assert t.evidence == 'present 7/7 samples over 3.0s'


def test_vehicle_passing_through_never_changes_the_state():
    bay = settled('free')
    trs = feed(bay, [0.7] * 4 + [0.0] * 10, start=20.0)   # 2 s in the bay, then gone
    assert trs == [] and bay.state == 'free' and bay.confirming is None


def test_single_missed_detection_does_not_free_a_bay_or_restart_confirmation():
    bay = settled('occupied')
    assert feed(bay, [0.9, 0.0, 0.9, 0.9, 0.0, 0.9] * 3, start=20.0) == []
    bay = settled('free')
    trs = feed(bay, [0.8, 0.8, 0.0, 0.8, 0.8, 0.8, 0.8], start=20.0)   # one miss while driving in
    assert [t.to_state for t in trs] == ['occupied'] and trs[0].evidence.startswith('present 6/7')


def test_leaving_takes_five_seconds():
    bay = settled('occupied')
    trs = feed(bay, [0.0] * 12, start=20.0)
    assert [(t.to_state, t.at, t.track_id) for t in trs] == [('free', 25.0, None)]


def test_hysteresis_keeps_a_score_hovering_between_thresholds_stable():
    bay = settled('occupied')
    assert feed(bay, [0.35, 0.32, 0.38] * 6, start=20.0) == []   # below 0.4 but above release 0.3
    bay = settled('free')
    assert feed(bay, [0.35, 0.32, 0.38] * 6, start=20.0) == []   # not enough to become present


def test_lost_feed_turns_bay_uncertain_then_recovers():
    bay = settled('occupied')                          # last sample at 9.5 s
    assert bay.tick(15.0) is None
    tr = bay.tick(19.5)
    assert (tr.from_state, tr.to_state, tr.evidence) == ('occupied', 'uncertain', 'no frame for 10.0s')
    assert bay.tick(30.0) is None                      # only reported once
    trs = feed(bay, [0.9] * 7, start=30.0)
    assert [(t.from_state, t.to_state) for t in trs] == [('uncertain', 'occupied')]


def test_confirming_is_reported_while_a_change_is_pending():
    bay = settled('free')
    feed(bay, [0.9] * 3, start=20.0)
    assert bay.state == 'free' and bay.confirming == 'occupied'


def test_rules_from_settings_and_validation():
    r = Rules.from_settings({'overlapThreshold': 0.5, 'confirmOccupiedSeconds': 3, 'confirmFreeSeconds': 5,
                             'sampleFps': 2})
    assert (r.threshold, r.release_threshold, r.confirm_free_s) == (0.5, 0.3, 5.0)
    assert Rules.from_settings({'overlapThreshold': 0.2}).release_threshold == 0.2
    with pytest.raises(ValueError):
        Rules(threshold=0.3, release_threshold=0.4)


def test_out_of_order_samples_are_rejected():
    bay = settled('free')
    with pytest.raises(ValueError):
        bay.observe(1.0, 0.5)
