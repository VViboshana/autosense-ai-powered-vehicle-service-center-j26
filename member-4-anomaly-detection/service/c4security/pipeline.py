"""Detect (YOLO11) -> track (ByteTrack) -> rules -> publish, on a video file, RTSP stream or webcam."""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path

import cv2
import yaml

from .engine import ThreatEngine, load_rules
from .publisher import AlertPublisher

log = logging.getLogger("c4security")
PKG = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = PKG / "models" / "component4_best.pt"
DEFAULT_RULES = PKG / "configs" / "threat_rules.yaml"
COLORS = {"visitor": (60, 200, 60), "worker": (230, 140, 30), "vehicle": (160, 160, 160), "threat": (0, 0, 255),
          "restricted": (0, 0, 200), "public": (0, 160, 0)}

_models = {}


def best_device():
    import torch
    if torch.cuda.is_available():
        return "0"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def load_model(path=DEFAULT_MODEL):
    """Model weights are loaded once per process (the tracker state is per stream, see `analyze`)."""
    from ultralytics import YOLO
    return YOLO(str(path))


def open_source(source):
    """'0' / 0 = webcam, 'rtsp://...' / 'http://...' = live camera, anything else = video file."""
    src = int(source) if str(source).isdigit() else str(source)
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        raise RuntimeError(f"cannot open video source: {source}")
    live = isinstance(src, int) or str(src).lower().startswith(("rtsp://", "rtmp://", "http://", "https://"))
    return cap, live


def draw(frame, engine, dets, banner, t):
    W, H = engine.W, engine.H
    for kind in ("restricted", "public"):
        for n, pg in engine.poly[kind]:
            cv2.polylines(frame, [pg], True, COLORS[kind], 2)
            cv2.putText(frame, n, (int(pg[0][0]) + 5, int(pg[0][1]) + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, COLORS[kind], 2)
    for d in dets:
        b = [int(v) for v in d["box"]]
        if d["cls"] == "person":
            col, lab = COLORS[d["role"]], f"{d['role']} {d['id'] or ''}{' MASK' if d['face'] else ''}"
        elif d["cls"] == "vehicle":
            col, lab = COLORS["vehicle"], f"vehicle {d['id'] or ''}"
        elif d["cls"] == "worker":
            continue
        else:
            col, lab = COLORS["threat"], f"{d['cls']} {d['conf']:.2f}"
        cv2.rectangle(frame, b[:2], b[2:], col, 2)
        cv2.putText(frame, lab, (b[0], max(15, b[1] - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, col, 2)
    for k, m in enumerate([m for ts, m in banner if t - ts <= 4.0][-3:]):
        cv2.rectangle(frame, (0, 8 + 34 * k), (min(W, 16 * len(m) + 20), 38 + 34 * k), (0, 0, 0), -1)
        cv2.putText(frame, m, (8, 32 + 34 * k), cv2.FONT_HERSHEY_SIMPLEX, 0.8, COLORS["threat"], 2)
    cv2.putText(frame, f"{engine.camera_id}  t={t:6.1f}s", (10, H - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    return frame


def analyze(source, out_dir, *, model=None, model_path=DEFAULT_MODEL, rules=DEFAULT_RULES, zones=None,
            overrides=(), start_time=None, device=None, save_video=True, webhook_url=None, on_alert=None,
            stop_event: threading.Event | None = None, engine_ready=None, max_seconds=None):
    """Run the full Component 4 pipeline on one source. Returns a summary dict.

    zones: path to a camera zone YAML or a dict. start_time: 'HH:MM' clock time of the first frame (files);
    live streams use the real clock. engine_ready(engine) is called once, so a caller can push bay.state updates.
    """
    cfg = load_rules(rules, overrides)
    zcfg = yaml.safe_load(open(zones)) if isinstance(zones, (str, Path)) else (zones or {})
    out = Path(out_dir)
    (out / "snapshots").mkdir(parents=True, exist_ok=True)
    for f in out.glob("snapshots/*.jpg"):
        f.unlink()
    (out / "alerts.jsonl").unlink(missing_ok=True)

    cap, live = open_source(source)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    fps = fps if 1 <= fps <= 120 else 25.0
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = 0 if live else int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if live:
        clock0 = datetime.now()
    else:
        clock0 = datetime.combine(datetime.now().date(), datetime.strptime(start_time, "%H:%M").time()) \
            if start_time else None
    engine = ThreatEngine(cfg, zcfg, W, H, clock0=clock0, source=str(source))
    if engine_ready:
        engine_ready(engine)

    model = model or load_model(model_path)
    names = model.names
    if "worker" not in names.values():
        log.warning("model has no `worker` class - every person is treated as a visitor")
    det = cfg["detection"]
    step = max(1, int(det.get("frame_step", 1)))
    min_conf = min([det["conf"], *det.get("class_conf", {}).values()])
    device = device or best_device()
    publisher = AlertPublisher(out / "alerts.jsonl", webhook_url, on_alert)
    writer = cv2.VideoWriter(str(out / "annotated.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), fps / step, (W, H)) \
        if save_video else None

    alerts, banner, fi, t, t_wall = [], [], -1, 0.0, time.time()
    try:
        while not (stop_event and stop_event.is_set()):
            ok, frame = cap.read()
            if not ok:
                if live:   # camera hiccup: retry instead of ending the stream
                    time.sleep(0.5)
                    cap.release()
                    cap, _ = open_source(source)
                    continue
                break
            fi += 1
            if fi % step:
                continue
            t = (time.time() - t_wall) if live else fi / fps
            if max_seconds and t > max_seconds:
                break
            r = model.track(frame, persist=True, tracker=det["tracker"], conf=min_conf, imgsz=det["imgsz"],
                            device=device, verbose=False)[0]
            bx = r.boxes
            ids = bx.id.int().tolist() if bx.id is not None else [None] * len(bx)
            raw = [{"cls": names[c], "conf": cf, "box": tuple(b), "id": tid}
                   for b, c, cf, tid in zip(bx.xyxy.tolist(), bx.cls.int().tolist(), bx.conf.tolist(), ids)]
            dets, new = engine.process(t, raw, fi)
            for a in new:
                snap = frame.copy()
                for b in a.pop("_boxes"):
                    cv2.rectangle(snap, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), COLORS["threat"], 4)
                fs = max(0.5, W / 1000)
                cv2.putText(snap, f"{a['severity']}: {a['threat_type']} t={t:.1f}s", (10, int(40 * fs)),
                            cv2.FONT_HERSHEY_SIMPLEX, fs, COLORS["threat"], 2)
                cv2.imwrite(str(out / a["snapshot"]), snap)
                publisher.publish(a)
                alerts.append(a)
                banner.append((t, f"{a['severity'].upper()}: {a['threat_type'].replace('_', ' ')}"
                                  + (f" (ID {a['person_track_id']})" if a["person_track_id"] else "")))
                log.info("[%7.1fs] %-8s %-20s conf %.2f vehicles %d people %d -> %s", t, a["severity"],
                         a["threat_type"], a["confidence"], len(a["affected_vehicles"]), a["affected_persons"],
                         ", ".join(a["notify_roles"]))
            if writer is not None:
                writer.write(draw(frame, engine, dets, banner, t))
    finally:
        cap.release()
        if writer is not None:
            writer.release()
        # a fresh tracker for the next stream that uses this model
        if getattr(model, "predictor", None) is not None and hasattr(model.predictor, "trackers"):
            del model.predictor.trackers

    summary = {"source": str(source), "camera_id": engine.camera_id, "frames": fi + 1, "video_s": round(t, 1),
               "processing_s": round(time.time() - t_wall, 1), "alerts": len(alerts),
               "tracked_people": engine.tracked_people(), "workers": len(engine.worker_ids()),
               "by_threat": {k: sum(a["threat_type"] == k for a in alerts) for k in {a["threat_type"] for a in alerts}},
               "out_dir": str(out)}
    write_summary(out, summary, alerts)
    return summary


def write_summary(out, s, alerts):
    lines = [f"# Video analysis — {Path(s['source']).name}", "",
             f"Camera `{s['camera_id']}` · {s['video_s']} s of video in {s['processing_s']} s · "
             f"**alerts: {s['alerts']}** · tracked people: {s['tracked_people']} (workers: {s['workers']})", "",
             "| # | time (s) | threat | severity | conf | person (role) | vehicles | people | why | notify |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for i, a in enumerate(alerts, 1):
        lines.append(f"| {i} | {a['video_time_s']} | {a['threat_type']} | {a['severity']} | {a['confidence']} | "
                     f"{a['person_track_id'] or '-'} ({a['person_role'] or '-'}) | {len(a['affected_vehicles'])} | "
                     f"{a['affected_persons']} | {', '.join(a['reasons'])} | {', '.join(a['notify_roles'])} |")
    (Path(out) / "summary.md").write_text("\n".join(lines) + "\n")
