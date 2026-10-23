"""Loads the vehicle detector once and returns vehicle boxes in image pixels."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from ultralytics import YOLO

from . import config

COCO_VEHICLES = [2, 3, 5, 7]  # car, motorcycle, bus, truck


@dataclass(frozen=True)
class Vehicle:
    bbox: tuple[float, float, float, float]   # x1, y1, x2, y2 in pixels
    confidence: float
    track_id: int | None = None


class Detector:
    """One YOLO detection model. With the COCO model only vehicle classes are kept; the fine-tuned model has one
    class (`vehicle`). `track` keeps ByteTrack state between calls, so use it for one video at a time."""

    def __init__(self, path: Path, imgsz: int = config.IMGSZ):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.model = YOLO(str(path))   # COCO weights are downloaded into model/ the first time
        self.imgsz = imgsz
        self.classes = COCO_VEHICLES if self.model.names.get(2) == 'car' else None
        self._lock = threading.Lock()  # one prediction at a time: the model object is not thread-safe
        self.detect(np.zeros((64, 64, 3), np.uint8))   # warm-up, so the first real request isn't slow

    def detect(self, image: np.ndarray, confidence: float = config.CONFIDENCE) -> list[Vehicle]:
        """image: BGR array."""
        with self._lock:
            r = self.model.predict(image, imgsz=self.imgsz, conf=confidence, classes=self.classes, verbose=False)[0]
        return [Vehicle(tuple(round(v, 1) for v in b), round(c, 4))
                for b, c in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist())]

    def track(self, image: np.ndarray, confidence: float = config.CONFIDENCE, reset: bool = False) -> list[Vehicle]:
        """Like detect, plus a track id per vehicle that stays the same across consecutive frames of one video."""
        with self._lock:
            if reset and getattr(self.model, 'predictor', None) is not None:
                for t in getattr(self.model.predictor, 'trackers', None) or []:
                    t.reset()
            r = self.model.track(image, imgsz=self.imgsz, conf=confidence, classes=self.classes, persist=True,
                                 tracker='bytetrack.yaml', verbose=False)[0]
        ids = r.boxes.id.int().tolist() if r.boxes.id is not None else [None] * len(r.boxes)
        return [Vehicle(tuple(round(v, 1) for v in b), round(c, 4), i)
                for b, c, i in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), ids)]
