import pytest

from app.association import associate, score, to_polygon

SQUARE = to_polygon([[0, 0], [10, 0], [10, 10], [0, 10]])


def test_box_filling_the_bay_scores_one_under_every_method():
    for method in ('coverage', 'iou', 'bottom_center'):
        assert score((0, 0, 10, 9.99), SQUARE, method) == pytest.approx(1.0, abs=0.01)


def test_coverage_is_share_of_the_bay_not_of_the_box():
    # box covers the left half of the bay and sticks far outside it
    assert score((-100, 0, 5, 10), SQUARE, 'coverage') == pytest.approx(0.5)
    assert score((-100, 0, 5, 10), SQUARE, 'iou') == pytest.approx(50 / 1100)


def test_bottom_center_uses_the_box_bottom_edge():
    assert score((2, -20, 8, 5), SQUARE, 'bottom_center') == 1.0   # bottom at y=5, inside
    assert score((2, -20, 8, -1), SQUARE, 'bottom_center') == 0.0  # bottom above the bay


def test_disjoint_and_degenerate_boxes_score_zero():
    assert score((20, 20, 30, 30), SQUARE) == 0.0
    assert score((5, 5, 5, 8), SQUARE) == 0.0


def test_associate_picks_best_detection_per_bay_and_applies_threshold():
    bays = {'B1': SQUARE, 'B2': to_polygon([[20, 0], [30, 0], [30, 10], [20, 10]])}
    dets = [(0, 0, 3, 10), (0, 0, 9, 10)]   # 30% and 90% of B1, nothing in B2
    m = {x.bay_id: x for x in associate(dets, bays, threshold=0.4)}
    assert m['B1'].detection == 1 and m['B1'].present
    assert m['B2'].detection is None and not m['B2'].present and m['B2'].score == 0.0


def test_vehicle_across_two_bays_is_reported_in_both():
    bays = {'B1': SQUARE, 'B2': to_polygon([[10, 0], [20, 0], [20, 10], [10, 10]])}
    m = associate([(5, 0, 15, 10)], bays, threshold=0.4)
    assert all(x.present and x.detection == 0 for x in m)


def test_invalid_polygons_are_rejected_or_repaired():
    with pytest.raises(ValueError):
        to_polygon([[0, 0], [1, 1]])
    bowtie = to_polygon([[0, 0], [10, 10], [10, 0], [0, 10]])
    assert bowtie.is_valid and bowtie.area > 0
