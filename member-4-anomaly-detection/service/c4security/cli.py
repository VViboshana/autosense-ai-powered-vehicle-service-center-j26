"""Command line: analyse one video file / live camera without the API.

  python -m c4security --source demo.mp4 --zones configs/zones/cam_01.yaml --start-time 21:30
  python -m c4security --source rtsp://user:pass@192.168.1.10/stream1 --zones configs/zones/cam_01.yaml
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from .pipeline import DEFAULT_MODEL, DEFAULT_RULES, PKG, analyze


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="video file, rtsp:// / http:// URL, or 0 for a webcam")
    ap.add_argument("--zones", default=None, help="camera zone file (configs/zones/*.yaml)")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    ap.add_argument("--rules", default=str(DEFAULT_RULES))
    ap.add_argument("--out", default=None, help="output folder (default runs/<source name>)")
    ap.add_argument("--start-time", default=None, help="HH:MM clock time of the first frame (video files)")
    ap.add_argument("--set", action="append", default=[], help="override a rule, e.g. loitering.dwell_s=20")
    ap.add_argument("--device", default=None, help="cpu | mps | 0 (default: best available)")
    ap.add_argument("--webhook", default=None, help="POST every alert to this URL")
    ap.add_argument("--no-video", action="store_true", help="do not write annotated.mp4")
    ap.add_argument("--max-seconds", type=float, default=None, help="stop after this much video time")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    out = a.out or PKG / "runs" / (Path(a.source).stem if not a.source.isdigit() else f"webcam{a.source}")
    s = analyze(a.source, out, model_path=a.model, rules=a.rules, zones=a.zones, overrides=a.set,
                start_time=a.start_time, device=a.device, save_video=not a.no_video, webhook_url=a.webhook,
                max_seconds=a.max_seconds)
    print(json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
