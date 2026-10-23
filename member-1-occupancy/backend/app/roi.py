"""Region-of-interest masking: grey out everything outside the bays before detection.

The fine-tuned model was trained on PKLot images greyed out outside the annotated spaces (eval/prepare_pklot.py,
`space_mask` / `apply_mask`). Given full, unmasked frames it misses most vehicles (domain shift), so the service
masks frames the same way: union of the bay polygons, grown by a margin, everything else filled with grey 114.
It also means nothing outside the bays (people, the street) is analysed. Keep this identical to prepare_pklot;
tests/test_roi.py checks that the two give the same mask.
"""
from __future__ import annotations

from typing import Sequence

import cv2
import numpy as np

from . import config

MASK_FILL = 114          # the grey YOLO uses for letterbox padding, as in training
REFERENCE_WIDTH = 1280   # width of the PKLot training images (1280x720); the margin is defined at this width
MIN_MARGIN_PX = 4        # small frames still keep a vehicle's edges


def margin_for(width: int, height: int, base: int | None = None) -> int:
    """The margin in this frame's pixels: `base` px at 1280 px wide (12/1280 = 0.94 % of the width), at least 4 px,
    so the margin matches training at any resolution. A base of 0 switches the margin off."""
    base = config.ROI_MARGIN_PX if base is None else base
    return 0 if base <= 0 else max(MIN_MARGIN_PX, round(base * width / REFERENCE_WIDTH))


def roi_mask(polygons_px: Sequence[Sequence[Sequence[float]]], width: int, height: int, margin: int) -> np.ndarray:
    """uint8 mask (255 = keep) covering every bay polygon (pixel coordinates), grown by `margin` pixels."""
    mask = np.zeros((height, width), np.uint8)
    for p in polygons_px:
        cv2.fillPoly(mask, [np.round(np.asarray(p, np.float32)).astype(np.int32)], 255)
    if margin > 0:
        mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * margin + 1, 2 * margin + 1)))
    return mask


def bay_mask(polygons: Sequence[Sequence[Sequence[float]]], width: int, height: int) -> np.ndarray:
    """The mask for normalised (0..1) bay polygons, as stored in occupancy.bays.polygon."""
    return roi_mask([[(x * width, y * height) for x, y in p] for p in polygons], width, height,
                    margin_for(width, height))


def apply_mask(image: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = image.copy()
    out[mask == 0] = MASK_FILL
    return out


def mask_default(placeholder: bool) -> bool:
    """Whether frames are masked when a request does not say: OCC_ROI_MASK, where auto follows the model."""
    return {'on': True, 'off': False}.get(config.ROI_MASK, not placeholder)
