from app.severity import assess, grade, locate

VEHICLE = {
    'bbox': [0, 0, 300, 100], 'areaPx': 20000, 'cropped': False,
    'polygon': [[0, 0], [300, 0], [300, 100], [0, 100]],
}


def damage(label, area_px, bbox=(10, 60, 40, 90)):
    x1, y1, x2, y2 = bbox
    return {'label': label, 'areaPx': area_px, 'bbox': list(bbox), 'polygon': [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]}


def test_dent_is_graded_by_its_share_of_the_vehicle():
    assert grade('dent', 0.005)[0] == 'minor'
    assert grade('dent', 0.01)[0] == 'moderate'  # a band's limit belongs to the next band
    assert grade('dent', 0.049)[0] == 'moderate'
    assert grade('dent', 0.05)[0] == 'severe'


def test_scratch_is_never_severe():
    assert grade('scratch', 0.02)[0] == 'minor'
    assert grade('scratch', 0.9)[0] == 'moderate'


def test_type_only_classes_ignore_size_and_vehicle():
    assert grade('glass_shatter', None)[0] == 'severe'
    assert grade('tire_flat', 0.001)[0] == 'severe'
    assert grade('lamp_broken', None)[0] == 'moderate'


def test_size_classes_without_a_vehicle_are_unavailable():
    severity, reason = grade('dent', None)
    assert severity == 'unavailable'
    assert 'No vehicle' in reason


def test_unknown_label_is_unavailable():
    assert grade('car', 0.5)[0] == 'unavailable'


def test_reason_states_the_share_and_the_rule():
    _, reason = grade('dent', 0.032)
    assert reason == 'dent covers 3.2% of the vehicle (under 1% minor, under 5% moderate, else severe).'


def test_location_is_relative_to_the_vehicle_box():
    assert locate([10, 60, 40, 90], VEHICLE['bbox']) == 'lower left'
    assert locate([140, 10, 160, 30], VEHICLE['bbox']) == 'upper centre'
    assert locate([250, 70, 290, 95], VEHICLE['bbox']) == 'lower right'


def test_overall_is_the_worst_detection():
    detections = [damage('scratch', 100), damage('dent', 400), damage('lamp_broken', 300)]  # minor, moderate, moderate
    result = assess(detections, VEHICLE)
    assert [d['severity'] for d in detections] == ['minor', 'moderate', 'moderate']
    assert detections[1]['areaRatioVehicle'] == 0.02
    assert result == {'overall': 'moderate', 'method': 'rule-v0', 'validated': False}


def test_overall_without_damage_is_none_and_without_vehicle_uses_type_only_classes():
    assert assess([], VEHICLE)['overall'] is None
    detections = [damage('dent', 400), damage('glass_shatter', 900)]
    assert assess(detections, None)['overall'] == 'severe'
    assert detections[0]['severity'] == 'unavailable'
    assert detections[0]['location'] is None


def test_damage_on_another_vehicle_is_kept_but_not_graded():
    detections = [damage('scratch', 100), damage('glass_shatter', 900, bbox=(400, 20, 460, 60))]  # 2nd: outside
    result = assess(detections, VEHICLE)
    assert [d['onVehicle'] for d in detections] == [True, False]
    assert detections[1]['severity'] is None
    assert result['overall'] == 'minor'  # the background car's shattered glass does not count


def test_damage_counts_when_most_of_it_is_on_the_vehicle():
    mostly_on = damage('dent', 400, bbox=(280, 40, 310, 60))   # 21 of 31 px columns inside the outline
    mostly_off = damage('dent', 400, bbox=(290, 40, 320, 60))  # 11 of 31 inside
    assess([mostly_on, mostly_off], VEHICLE)
    assert mostly_on['onVehicle'] is True and 0.6 < mostly_on['vehicleOverlap'] < 0.75
    assert mostly_off['onVehicle'] is False and mostly_off['vehicleOverlap'] < 0.5


def test_car_behind_the_roofline_is_not_on_the_vehicle():
    # Its box centre sits just inside the outline, but most of its area is above it (the red Mazda photo case)
    behind = damage('scratch', 400, bbox=(200, -40, 260, 10))
    assess([behind], VEHICLE)
    assert behind['onVehicle'] is False


def test_only_background_damage_means_no_damage_on_the_vehicle():
    assert assess([damage('dent', 400, bbox=(400, 20, 460, 60))], VEHICLE)['overall'] is None


def test_without_a_vehicle_all_damage_counts():
    detections = [damage('glass_shatter', 900, bbox=(400, 20, 460, 60))]
    assert assess(detections, None)['overall'] == 'severe'
    assert detections[0]['onVehicle'] is True


def test_cropped_vehicle_is_mentioned_only_when_size_decided_the_grade():
    detections = [damage('dent', 400), damage('glass_shatter', 400), damage('car', 400)]
    assess(detections, {**VEHICLE, 'cropped': True})
    assert 'Only part of the vehicle' in detections[0]['severityReason']
    assert 'Only part of the vehicle' not in detections[1]['severityReason']
    assert 'Only part of the vehicle' not in detections[2]['severityReason']
