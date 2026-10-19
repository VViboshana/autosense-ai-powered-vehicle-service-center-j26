"""Vehicle-to-bay association.

A bay is a polygon in image coordinates; a detection is an axis-aligned box (x1, y1, x2, y2). Boxes and polygons
must use the same coordinate space (pixels, or both normalised to 0..1). Three scoring methods are compared in the
evaluation (hypothesis H1), so all of them live here behind one function:

  coverage       area(box ∩ bay) / area(bay)   how much of the bay a vehicle fills (default)
  iou            area(box ∩ bay) / area(box ∪ bay)
  bottom_center  1.0 if the middle of the box's bottom edge (where the wheels meet the floor) is inside the bay

`associate` gives every bay its best-scoring detection; a bay is "present" when that score reaches the threshold.
Turning per-frame presence into a committed occupied/free state is the state machine's job, not this module's.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from shapely.geometry import Point, Polygon, box

Method = Literal['coverage', 'iou', 'bottom_center']
METHODS: tuple[Method, ...] = ('coverage', 'iou', 'bottom_center')

BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class BayMatch:
    bay_id: str
    score: float              # 0..1 under the chosen method
    detection: int | None     # index into the detections list, None when nothing touches the bay
    present: bool             # score >= threshold


def to_polygon(points: Sequence[Sequence[float]]) -> Polygon:
    """Builds a valid polygon from [[x, y], ...]; self-intersecting outlines are repaired with buffer(0)."""
    if len(points) < 3:
        raise ValueError('A bay polygon needs at least 3 points.')
    poly = Polygon([(float(x), float(y)) for x, y in points])
    if not poly.is_valid:
        poly = poly.buffer(0)
    if poly.is_empty or poly.area <= 0:
        raise ValueError('A bay polygon must enclose a non-zero area.')
    return poly


def score(bbox: BBox, bay: Polygon, method: Method = 'coverage') -> float:
    x1, y1, x2, y2 = bbox
    if x2 <= x1 or y2 <= y1:
        return 0.0
    if method == 'bottom_center':
        return 1.0 if bay.covers(Point((x1 + x2) / 2, y2)) else 0.0
    b = box(x1, y1, x2, y2)
    inter = b.intersection(bay).area
    if inter <= 0:
        return 0.0
    if method == 'coverage':
        return min(1.0, inter / bay.area)
    if method == 'iou':
        return inter / (b.area + bay.area - inter)
    raise ValueError(f'Unknown association method: {method}')


def associate(
    detections: Sequence[BBox],
    bays: dict[str, Polygon],
    method: Method = 'coverage',
    threshold: float = 0.4,
) -> list[BayMatch]:
    """Best detection per bay. One vehicle may legitimately touch two bays (parked across a line); both then
    report it, which is the behaviour we want to measure rather than hide."""
    matches: list[BayMatch] = []
    for bay_id, poly in bays.items():
        best_score, best_idx = 0.0, None
        for i, det in enumerate(detections):
            s = score(det, poly, method)
            if s > best_score:
                best_score, best_idx = s, i
        matches.append(BayMatch(bay_id, best_score, best_idx, best_score >= threshold))
    return matches
