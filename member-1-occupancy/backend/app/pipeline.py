"""Video -> sampled frames -> vehicles -> bay scores -> per-bay state machine -> transitions.

Bay polygons arrive normalised to 0..1 (as stored in occupancy.bays.polygon) and are scaled to the video's pixel
size once. Frames are sampled at `sample_fps` (default 2): occupancy changes over seconds, so analysing every
frame would only cost time. Stream time (frame index / video fps) drives the state machine, so a recorded video
gives the same result however fast the computer processes it.

With `mask=True` every sampled frame is greyed out outside the bays (plus a margin) before detection, as the
fine-tuned model was trained (see roi.py).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from typing import Callable, Protocol, Sequence

import cv2
import numpy as np

from .association import Method, associate, to_polygon
from .detector import Vehicle
from .roi import apply_mask, bay_mask
from .state_machine import BayTracker, Rules, Transition


class VehicleSource(Protocol):
    def track(self, image: np.ndarray, confidence: float = ..., reset: bool = ...) -> list[Vehicle]: ...


@dataclass
class BayConfig:
    bay_id: str
    polygon: Sequence[Sequence[float]]   # normalised [[x, y], ...]


@dataclass
class Progress:
    frames_processed: int = 0     # sampled frames analysed
    total_frames: int | None = None
    stream_s: float = 0.0
    states: dict = field(default_factory=dict)   # bay_id -> {'state', 'confirming', 'score', 'trackId'}


def scale_polygon(points, width: int, height: int):
    return to_polygon([(x * width, y * height) for x, y in points])


def process_video(
    source: str,
    bays: list[BayConfig],
    detector: VehicleSource,
    rules: Rules = Rules(),
    sample_fps: float = 2.0,
    method: Method = 'coverage',
    mask: bool = False,
    on_transition: Callable[[Transition], None] = lambda t: None,
    on_progress: Callable[[Progress], None] = lambda p: None,
    stop: threading.Event | None = None,
) -> Progress:
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise ValueError(f'Cannot open video source: {source}')
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or None
        step = max(1, round(fps / sample_fps))
        polys = {b.bay_id: scale_polygon(b.polygon, width, height) for b in bays}
        trackers = {b.bay_id: BayTracker(b.bay_id, rules) for b in bays}
        progress = Progress(total_frames=(n + step - 1) // step if n else None)
        index, first = 0, True
        roi = None   # built from the first frame's real size (some streams report no size before decoding)
        while not (stop and stop.is_set()):
            if not cap.grab():
                break
            if index % step == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    break
                if mask:
                    if roi is None or roi.shape != frame.shape[:2]:
                        roi = bay_mask([b.polygon for b in bays], frame.shape[1], frame.shape[0])
                    frame = apply_mask(frame, roi)
                t = index / fps
                vehicles = detector.track(frame, reset=first)
                first = False
                matches = associate([v.bbox for v in vehicles], polys, method, rules.threshold)
                for m in matches:
                    track_id = vehicles[m.detection].track_id if m.detection is not None else None
                    tr = trackers[m.bay_id].observe(t, m.score, track_id)
                    if tr:
                        on_transition(tr)
                    progress.states[m.bay_id] = {'state': trackers[m.bay_id].state,
                                                 'confirming': trackers[m.bay_id].confirming,
                                                 'score': round(m.score, 3), 'trackId': track_id}
                progress.frames_processed += 1
                progress.stream_s = round(t, 2)
                on_progress(progress)
            index += 1
        return progress
    finally:
        cap.release()


def read_frame(source: str, at_s: float = 0.0) -> np.ndarray:
    """One frame (BGR) at `at_s` seconds, for drawing bay outlines."""
    cap = cv2.VideoCapture(source)
    try:
        if not cap.isOpened():
            raise ValueError(f'Cannot open video source: {source}')
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, at_s) * 1000)
        ok, frame = cap.read()
        if not ok:
            raise ValueError('No frame at that time.')
        return frame
    finally:
        cap.release()
