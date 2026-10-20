"""
Preliminary severity (rule-v0): damage type + damage size relative to the vehicle -> minor / moderate / severe.
The thresholds live in severity_rules.json so they can be tuned with the technician without changing code.
Results are suggestions for staff to confirm (damage.inspections.severity_validated stays false).
"""
import json
from pathlib import Path

import cv2
import numpy as np

RULES = json.loads(Path(__file__).with_name('severity_rules.json').read_text(encoding='utf-8'))
ORDER = ['minor', 'moderate', 'severe']


def grade(label: str, ratio: float | None, rules: dict = RULES) -> tuple[str, str]:
    """Severity and a one-line reason for one damage region."""
    rule = rules['classes'].get(label)
    if rule is None:
        return 'unavailable', f'No severity rule for "{label}".'
    if not rule['bands']:
        return rule['otherwise'], f"{label.replace('_', ' ')}: {rule['why']}."
    if ratio is None:
        return 'unavailable', 'No vehicle found in the photo, so the damage size cannot be judged.'

    steps = ', '.join(f"under {b['below']:.0%} {b['severity']}" for b in rule['bands'])
    for band in rule['bands']:
        if ratio < band['below']:
            severity = band['severity']
            break
    else:
        severity = rule['otherwise']
    return severity, f"{label.replace('_', ' ')} covers {ratio:.1%} of the vehicle ({steps}, else {rule['otherwise']})."


def locate(bbox: list[int], vehicle_bbox: list[int]) -> str:
    """Where the damage centre sits on the vehicle as seen in the photo, e.g. 'lower left'."""
    vx1, vy1, vx2, vy2 = vehicle_bbox
    cx = ((bbox[0] + bbox[2]) / 2 - vx1) / max(vx2 - vx1, 1)
    cy = ((bbox[1] + bbox[3]) / 2 - vy1) / max(vy2 - vy1, 1)
    row = 'upper' if cy < 0.5 else 'lower'
    col = 'left' if cx < 1 / 3 else 'centre' if cx < 2 / 3 else 'right'
    return f'{row} {col}'


MIN_VEHICLE_OVERLAP = 0.5  # at least half of the damage area must lie on the inspected vehicle


def vehicle_overlap(polygon: list[list[int]], bbox: list[int], vehicle_polygon: list[list[int]]) -> float:
    """
    Share of the damage area that lies inside the vehicle outline (0-1). Each pixel belongs to one visible object,
    so damage on the inspected vehicle is mostly inside its outline, and damage on a car behind it mostly outside.
    Both outlines are drawn on a small canvas the size of the damage box and their pixels are compared.
    """
    x1, y1, x2, y2 = bbox
    size = (y2 - y1 + 1, x2 - x1 + 1)
    damage, vehicle = np.zeros(size, np.uint8), np.zeros(size, np.uint8)
    shift = np.array([x1, y1])
    cv2.fillPoly(damage, [np.array(polygon, np.int32) - shift], 1)
    cv2.fillPoly(vehicle, [np.array(vehicle_polygon, np.int32) - shift], 1)
    area = int(damage.sum())
    return float((damage & vehicle).sum()) / area if area else 0.0


def assess(detections: list[dict], vehicle: dict | None, rules: dict = RULES) -> dict:
    """
    Adds vehicleOverlap, onVehicle, areaRatioVehicle, location, severity and severityReason to each detection; returns
    the overall result. Damage that is not on the inspected vehicle is kept (staff can see it) but gets no severity
    and does not count towards the overall result.
    """
    for d in detections:
        overlap = vehicle_overlap(d['polygon'], d['bbox'], vehicle['polygon']) if vehicle else None
        d['vehicleOverlap'] = round(overlap, 2) if overlap is not None else None
        d['onVehicle'] = overlap is None or overlap >= MIN_VEHICLE_OVERLAP
        if not d['onVehicle']:
            d.update(areaRatioVehicle=None, location=None, severity=None,
                     severityReason="Outside the inspected vehicle's outline (e.g. on another car), so it is not graded.")
            continue
        ratio = d['areaPx'] / vehicle['areaPx'] if vehicle and vehicle['areaPx'] else None
        d['areaRatioVehicle'] = round(ratio, 4) if ratio is not None else None
        d['location'] = locate(d['bbox'], vehicle['bbox']) if vehicle else None
        d['severity'], d['severityReason'] = grade(d['label'], ratio, rules)
        size_based = bool(rules['classes'].get(d['label'], {}).get('bands'))
        if size_based and ratio is not None and vehicle.get('cropped'):
            d['severityReason'] += ' Only part of the vehicle is in the photo, so the share may be overstated.'

    # Possible damage is graded (so it is ready if the technician accepts it) but does not count until then
    on = [d for d in detections if d['onVehicle'] and not d.get('possible')]
    known = [d['severity'] for d in on if d['severity'] in ORDER]
    if known:
        overall = max(known, key=ORDER.index)
    else:
        overall = 'unavailable' if on else None  # None: no damage found on the vehicle
    return {'overall': overall, 'method': rules['method'], 'validated': False}
