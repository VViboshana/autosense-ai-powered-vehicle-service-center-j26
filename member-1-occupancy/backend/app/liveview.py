"""Pictures for the live bay tiles: one bay cut out of the latest analysed frame, with its outline and the vehicles the
detector found drawn on, as a JPEG. The frame is the camera's picture before ROI masking (what staff would see on
the camera); the bay state itself is shown by the web app, not drawn here.
"""
from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np

from .detector import Vehicle

CONTEXT = 0.6          # show this much of the bay's size around it on each side, so arriving cars are visible
MIN_SIDE_PX = 160      # never crop smaller than this (PKLot spaces are small in the frame)
WHITE, DARK = (255, 255, 255), (20, 20, 20)


def _outline(img: np.ndarray, pts: np.ndarray, thickness: int) -> None:
    """A white line with a dark edge: visible on bright and dark backgrounds alike."""
    cv2.polylines(img, [pts], True, DARK, thickness + 2, cv2.LINE_AA)
    cv2.polylines(img, [pts], True, WHITE, thickness, cv2.LINE_AA)


def render(frame: np.ndarray, vehicles: Sequence[Vehicle], polygon: Sequence[Sequence[float]] | None = None,
           width: int = 480, quality: int = 80) -> bytes:
    """JPEG of the whole frame, or of the area around `polygon` (normalised 0..1) when given, `width` px wide."""
    h, w = frame.shape[:2]
    img = frame.copy()
    for v in vehicles:
        x1, y1, x2, y2 = (int(round(c)) for c in v.bbox)
        _outline(img, np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.int32), 1)
    if polygon is not None:
        pts = np.round(np.asarray(polygon, np.float32) * [w, h]).astype(np.int32)
        _outline(img, pts, 2)
        x, y, bw, bh = cv2.boundingRect(pts)
        side = max(bw, bh) * (1 + 2 * CONTEXT)
        side = max(side, MIN_SIDE_PX)
        cx, cy = x + bw / 2, y + bh / 2
        cw, ch = side * 4 / 3, side          # 4:3, like the tiles
        x0 = int(max(0, min(w - cw, cx - cw / 2)))
        y0 = int(max(0, min(h - ch, cy - ch / 2)))
        img = img[y0:int(min(h, y0 + ch)), x0:int(min(w, x0 + cw))]
    scale = width / img.shape[1]
    img = cv2.resize(img, (width, max(1, round(img.shape[0] * scale))),
                     interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)
    ok, jpg = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise ValueError('The picture could not be encoded.')
    return jpg.tobytes()
