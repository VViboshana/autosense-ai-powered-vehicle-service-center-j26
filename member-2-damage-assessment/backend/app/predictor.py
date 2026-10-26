"""Loads a YOLO segmentation model once and turns its output into regions in image pixels."""
import threading
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from . import config


class SegModel:
    """One YOLO-seg model. Used twice: the damage model (CarDD) and the vehicle finder (COCO)."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.model = YOLO(str(path))  # COCO weights are downloaded into model/ the first time
        self.classes = list(self.model.names.values())
        self._lock = threading.Lock()  # one prediction at a time: the model object is not thread-safe
        self.predict(np.zeros((64, 64, 3), np.uint8), config.CONFIDENCE)  # warm-up, so the first real request isn't slow

    def predict(self, image: np.ndarray, confidence: float, classes: list[int] | None = None) -> list[dict]:
        """image: BGR array. Returns one dict per region found (optionally only the given class ids)."""
        with self._lock:
            result = self.model.predict(image, imgsz=config.IMGSZ, conf=confidence, classes=classes, verbose=False)[0]
        if result.masks is None:
            return []

        # Masks are predicted at low resolution and scaled up, so big photos get a staircase outline (about 6 px steps
        # on a 12 MP photo). Simplify in proportion to the photo size: same shape, far fewer points.
        tolerance = max(1.0, 0.0015 * max(image.shape[:2]))
        regions = []
        for box, conf, cls, outline in zip(
            result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist(), result.masks.xy
        ):
            if len(outline) < 3:  # a mask too small to form a shape
                continue
            contour = outline.astype(np.float32).reshape(-1, 1, 2)
            simplified = cv2.approxPolyDP(contour, tolerance, True).reshape(-1, 2)
            regions.append({
                'label': self.model.names[int(cls)],
                'confidence': round(conf, 4),
                'bbox': [round(v) for v in box],                        # [x1, y1, x2, y2]
                'polygon': [[round(x), round(y)] for x, y in simplified],
                'areaPx': round(cv2.contourArea(contour)),              # pixels inside the outline
            })
        return regions


VEHICLE_CLASSES = [2, 3, 5, 7]  # COCO ids: car, motorcycle, bus, truck
PERSON_CLASS = 0
PERSON_MIN_SHARE = 0.03  # a person this large in the frame is what the camera is pointed at, not a passer-by far away


def look(model: SegModel, image: np.ndarray) -> tuple[dict | None, bool]:
    """One COCO pass: the main vehicle (or None), and whether a person is clearly in view. The damage model only knows
    cars, so without a vehicle it would still find "damage" in anything (a shirt, a face): callers use this to say so."""
    regions = model.predict(image, config.VEHICLE_CONFIDENCE, VEHICLE_CLASSES + [PERSON_CLASS])
    height, width = image.shape[:2]
    person = any(r['label'] == 'person' and r['areaPx'] >= PERSON_MIN_SHARE * width * height for r in regions)
    return find_vehicle_in([r for r in regions if r['label'] != 'person'], width, height), person


def find_vehicle(model: SegModel, image: np.ndarray) -> dict | None:
    """The main vehicle in the photo (the largest one), or None when no vehicle is found."""
    height, width = image.shape[:2]
    return find_vehicle_in(model.predict(image, config.VEHICLE_CONFIDENCE, VEHICLE_CLASSES), width, height)


def find_vehicle_in(vehicles: list[dict], width: int, height: int) -> dict | None:
    if not vehicles:
        return None
    vehicle = max(vehicles, key=lambda v: v['areaPx'])
    x1, y1, x2, y2 = vehicle['bbox']
    # Touching two or more photo edges (within 1% of the photo size): only part of the vehicle is visible (a close-up)
    mx, my = 0.01 * width, 0.01 * height
    edges = sum([x1 <= mx, y1 <= my, x2 >= width - mx, y2 >= height - my])
    vehicle['cropped'] = edges >= 2
    return vehicle
