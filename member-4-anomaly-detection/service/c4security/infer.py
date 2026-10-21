"""Model check: load the weights named in configs/integration.yaml, compare the class names with the training order,
and run the model on one frame.

  python -m c4security.infer                 # a generated grey frame (no people; 0 detections expected)
  python -m c4security.infer --image x.jpg   # a frame you choose
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import numpy as np

from .alert_format import PKG, load_integration


def weights_path(cfg: dict) -> Path:
    """C4_MODEL wins over the config; a relative path is relative to service/."""
    p = Path(os.getenv("C4_MODEL") or cfg["model"]["weights"])
    return p if p.is_absolute() else PKG / p


def load(cfg: dict | None = None):
    from ultralytics import YOLO

    cfg = cfg or load_integration()
    path = weights_path(cfg)
    if not path.exists():
        raise FileNotFoundError(f"Model weights not found: {path}")
    return YOLO(str(path))


def class_names(model) -> list[str]:
    return [model.names[i] for i in sorted(model.names)]


def check_classes(model, cfg: dict) -> tuple[bool, list[str], list[str]]:
    expected = list(cfg["model"]["classes"])
    actual = class_names(model)
    return actual == expected, actual, expected


def blank_frame(width=640, height=480) -> np.ndarray:
    return np.full((height, width, 3), 114, np.uint8)


def run_once(model, frame, imgsz=640, conf=0.25):
    result = model.predict(frame, imgsz=imgsz, conf=conf, verbose=False)[0]
    return [
        {"cls": model.names[int(b.cls)], "conf": round(float(b.conf), 3), "box": [round(v, 1) for v in b.xyxy[0].tolist()]}
        for b in result.boxes
    ]


def main():
    ap = argparse.ArgumentParser(description="Load the Component 4 model and run it on one frame.")
    ap.add_argument("--image", help="image file to test (default: a generated grey frame)")
    args = ap.parse_args()

    cfg = load_integration()
    print("weights :", weights_path(cfg).relative_to(PKG) if weights_path(cfg).is_relative_to(PKG) else weights_path(cfg))
    model = load(cfg)
    ok, actual, expected = check_classes(model, cfg)
    print("classes :", ", ".join(f"{i}:{n}" for i, n in enumerate(actual)))
    print("order   :", "matches the training order" if ok else f"DOES NOT MATCH, expected {expected}")

    if args.image:
        import cv2

        frame = cv2.imread(args.image)
        if frame is None:
            raise SystemExit(f"Cannot read image: {args.image}")
    else:
        frame = blank_frame()
    dets = run_once(model, frame, imgsz=cfg["model"].get("test_imgsz", 640))
    print(f"frame   : {'generated grey 640x480' if not args.image else args.image} -> {len(dets)} detections")
    for d in dets:
        print("   ", d)
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
