from app.findings import split_findings
from app.severity import assess


def region(label, confidence, x1, y1, x2, y2):
    return {'label': label, 'confidence': confidence, 'bbox': [x1, y1, x2, y2], 'areaPx': (x2 - x1) * (y2 - y1),
            'polygon': [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]}


def test_regions_at_or_above_the_threshold_are_findings_and_weaker_ones_possible():
    out = split_findings([region('dent', 0.6, 0, 0, 10, 10), region('scratch', 0.25, 20, 0, 30, 10),
                          region('crack', 0.12, 40, 0, 50, 10)], confidence=0.25, max_possible=5)
    assert [(r['label'], r['possible']) for r in out] == [('dent', False), ('scratch', False), ('crack', True)]


def test_a_weaker_region_on_top_of_a_finding_is_a_duplicate_and_dropped():
    out = split_findings([region('dent', 0.6, 0, 0, 10, 10), region('scratch', 0.2, 1, 1, 9, 9)], 0.25, 5)
    assert [r['label'] for r in out] == ['dent']


def test_possible_damage_is_limited_to_the_strongest_few():
    weak = [region('dent', c, i * 20, 0, i * 20 + 10, 10) for i, c in enumerate([0.11, 0.2, 0.15, 0.24])]
    out = split_findings(weak, 0.25, max_possible=2)
    assert [r['confidence'] for r in out] == [0.24, 0.2]


def test_possible_damage_does_not_change_the_overall_severity():
    vehicle = {'bbox': [0, 0, 100, 100], 'areaPx': 10000, 'cropped': False,
               'polygon': [[0, 0], [100, 0], [100, 100], [0, 100]]}
    detections = split_findings([region('scratch', 0.5, 0, 0, 10, 10), region('glass_shatter', 0.15, 50, 50, 90, 90)], 0.25, 5)
    result = assess(detections, vehicle)
    assert detections[1]['severity'] == 'severe'  # graded, ready if accepted
    assert result['overall'] == 'minor'           # but only the finding counts


def test_glass_needs_the_stricter_bar_to_be_a_finding():
    regions = [region('glass_shatter', 0.9, 0, 0, 10, 10), region('glass_shatter', 0.5, 20, 0, 30, 10),
               region('dent', 0.5, 40, 0, 50, 10)]
    out = split_findings(regions, 0.25, 5, strict={'glass_shatter': 0.7})
    assert [(r['confidence'], r['label'], r['possible']) for r in out] == [
        (0.9, 'glass_shatter', False), (0.5, 'dent', False), (0.5, 'glass_shatter', True)]
