"""Loads the YOLO11-seg model once and turns its output into damage detections in image pixels."""
import threading

import cv2
import numpy as np
from ultralytics import YOLO

from . import config


class DamagePredictor:
    def __init__(self):
        self.placeholder = not config.MODEL_PATH.exists()
        path = config.FALLBACK_MODEL_PATH if self.placeholder else config.MODEL_PATH
        path.parent.mkdir(parents=True, exist_ok=True)
        self.model = YOLO(str(path))  # downloads the COCO weights into model/ the first time
        self.version = 'coco-placeholder' if self.placeholder else config.MODEL_VERSION
        self.classes = list(self.model.names.values())
        self._lock = threading.Lock()  # one prediction at a time: the model object is not thread-safe
        self.predict(np.zeros((64, 64, 3), np.uint8))  # warm-up, so the first real request isn't slow

    def predict(self, image: np.ndarray, confidence: float = config.CONFIDENCE) -> list[dict]:
        """image: BGR array. Returns one dict per damage region found."""
        with self._lock:
            result = self.model.predict(image, imgsz=config.IMGSZ, conf=confidence, verbose=False)[0]
        if result.masks is None:
            return []

        detections = []
        for box, conf, cls, outline in zip(
            result.boxes.xyxy.tolist(), result.boxes.conf.tolist(), result.boxes.cls.tolist(), result.masks.xy
        ):
            if len(outline) < 3:  # a mask too small to form a shape
                continue
            contour = outline.astype(np.float32).reshape(-1, 1, 2)
            # Drop points that add less than 1 px of detail: smaller JSON, same shape
            simplified = cv2.approxPolyDP(contour, 1.0, True).reshape(-1, 2)
            detections.append({
                'label': self.model.names[int(cls)],
                'confidence': round(conf, 4),
                'bbox': [round(v) for v in box],                        # [x1, y1, x2, y2]
                'polygon': [[round(x), round(y)] for x, y in simplified],
                'areaPx': round(cv2.contourArea(contour)),              # pixels inside the outline
            })
        return detections
