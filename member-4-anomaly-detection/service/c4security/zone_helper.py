"""Draw a coordinate grid on the first frame of a video / camera, to write the zones of configs/zones/<camera>.yaml.

Points in the zone file are fractions of the frame (0-1). Read the grid: e.g. a work bay covering the right half
of the image from 35% height down is [[0.5,0.35],[1,0.35],[1,1],[0.5,1]].
Usage: python -m c4security.zone_helper --source my.mp4 (or rtsp://...) [--zones configs/zones/cam_01.yaml]
Writes runs/zone_helper/<name>.jpg (zones drawn too, if a zone file is given).
"""
import argparse
from pathlib import Path

import cv2
import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]


ap = argparse.ArgumentParser()
ap.add_argument("--source", required=True, help="video file, rtsp:// URL or 0 for a webcam")
ap.add_argument("--zones")
ap.add_argument("--second", type=float, default=0.0, help="take the frame at this time (s)")
a = ap.parse_args()
cap = cv2.VideoCapture(int(a.source) if a.source.isdigit() else a.source)
cap.set(cv2.CAP_PROP_POS_MSEC, a.second * 1000)
ok, img = cap.read()
if not ok:
    raise SystemExit(f"cannot read {a.source}")
H, W = img.shape[:2]
for k in range(1, 10):
    x, y = int(W * k / 10), int(H * k / 10)
    cv2.line(img, (x, 0), (x, H), (255, 255, 255), 1)
    cv2.line(img, (0, y), (W, y), (255, 255, 255), 1)
    cv2.putText(img, f"{k / 10:.1f}", (x + 3, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
    cv2.putText(img, f"{k / 10:.1f}", (3, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)
if a.zones:
    z = yaml.safe_load(open(a.zones))
    for kind, col in (("restricted", (0, 0, 255)), ("public", (0, 200, 0))):
        for zone in z.get(kind, []):
            pts = (np.array(zone["points"]) * [W, H]).astype(np.int32)
            cv2.polylines(img, [pts], True, col, 2)
            cv2.putText(img, zone["name"], (int(pts[0][0]) + 5, int(pts[0][1]) + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
out = ROOT / "runs" / "zone_helper" / (Path(a.source).stem + ".jpg")
out.parent.mkdir(parents=True, exist_ok=True)
cv2.imwrite(str(out), img)
print("open:", out)
