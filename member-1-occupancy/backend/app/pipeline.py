"""Video -> sampled frames -> vehicles -> bay scores -> per-bay state machine -> transitions.

Bay polygons arrive normalised to 0..1 (as stored in occupancy.bays.polygon) and are scaled to the video's pixel
size once. Frames are sampled at `sample_fps` (default 2): occupancy changes over seconds, so analysing every
frame would only cost time. Stream time (frame index / video fps) drives the state machine, so a recorded video
gives the same result however fast the computer processes it.

With `mask=True` every sampled frame is greyed out outside the bays (plus a margin) before detection, as the
fine-tuned model was trained (see roi.py). With `live=True` a recorded video is replayed as a live camera: real time,
looping, newest frame only, time = wall-clock seconds since the start (a stand-in until real camera streams, task 1).
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Iterator, Protocol, Sequence

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


def _sampled_frames(source: str, cap: cv2.VideoCapture, fps: float, sample_fps: float, live: bool,
                    stop: threading.Event | None) -> Iterator[tuple[np.ndarray, float]]:
    """(frame, t) pairs. Recorded: every `step`-th frame, t = frame time in the video, as fast as the computer goes.
    Live replay: the video plays in real time on a loop like a camera that never stops; each sample takes the frame
    showing *now* (frames that went by while the detector was busy are skipped, as with a real camera), and t is
    seconds since the job started (wall clock)."""
    stopped = lambda: bool(stop and stop.is_set())   # noqa: E731
    if not live:
        step = max(1, round(fps / sample_fps))
        index = 0
        while not stopped() and cap.grab():
            if index % step == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    return
                yield frame, index / fps
            index += 1
        return

    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if n <= 0:
        raise ValueError('Live replay needs a recorded video with a known length.')
    duration, start = n / fps, time.monotonic()
    loop, pos = 0, 0                 # current pass through the video; frames read in this pass
    while not stopped():
        elapsed = time.monotonic() - start
        this_loop, into = divmod(elapsed, duration)
        if this_loop != loop:        # the video ended: start again from the first frame
            cap.release()
            cap.open(source)
            loop, pos = this_loop, 0
        target = min(n - 1, int(into * fps))
        while pos <= target and cap.grab():
            pos += 1
        ok, frame = cap.retrieve()
        if not ok:
            raise ValueError('The video could not be read during live replay.')
        yield frame, round(elapsed, 2)
        wait = (elapsed + 1 / sample_fps) - (time.monotonic() - start)   # at most sample_fps samples per second
        if wait > 0 and stop is not None:
            stop.wait(wait)
        elif wait > 0:
            time.sleep(wait)


def process_video(
    source: str,
    bays: list[BayConfig],
    detector: VehicleSource,
    rules: Rules = Rules(),
    sample_fps: float = 2.0,
    method: Method = 'coverage',
    mask: bool = False,
    live: bool = False,
    on_transition: Callable[[Transition], None] = lambda t: None,
    on_progress: Callable[[Progress], None] = lambda p: None,
    on_frame: Callable[[np.ndarray, list[Vehicle], float], None] = lambda f, v, t: None,
    stop: threading.Event | None = None,
) -> Progress:
    """`live=True` replays a recorded video as a live camera (see _sampled_frames); it runs until `stop` is set.
    `on_frame` gets every analysed frame as the camera saw it (before masking), its vehicles and its time."""
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
        progress = Progress(total_frames=(n + step - 1) // step if n and not live else None)
        first = True
        roi = None   # built from the first frame's real size (some streams report no size before decoding)
        for seen, t in _sampled_frames(source, cap, fps, sample_fps, live, stop):
            frame = seen
            if mask:
                if roi is None or roi.shape != frame.shape[:2]:
                    roi = bay_mask([b.polygon for b in bays], frame.shape[1], frame.shape[0])
                frame = apply_mask(frame, roi)
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
            on_frame(seen, vehicles, t)
            on_progress(progress)
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
