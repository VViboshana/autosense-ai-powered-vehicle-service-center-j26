"""Runs video jobs one at a time in a background thread and keeps their status in memory.

One at a time because the detector's tracker state belongs to one video. The API owns the durable record
(occupancy.video_jobs, bay_state_events); this service only reports what happened while it runs.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from typing import Literal

from .pipeline import BayConfig, Progress, process_video
from .state_machine import Rules, Transition

Status = Literal['queued', 'running', 'completed', 'failed', 'cancelled']


@dataclass
class Job:
    job_id: str
    source: str
    bays: list[BayConfig]
    rules: Rules
    sample_fps: float
    mask: bool = False          # frames greyed out outside the bays before detection (roi.py)
    live: bool = False          # replay the video as a live camera until cancelled (pipeline._sampled_frames)
    views: dict = field(default_factory=dict)   # bay_id -> normalised (x0, y0, x1, y1) its live picture stays inside
    status: Status = 'queued'
    progress: Progress = field(default_factory=Progress)
    transitions: list[Transition] = field(default_factory=list)
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    stop: threading.Event = field(default_factory=threading.Event)
    # The latest analysed frame (before masking) and its vehicles, for the live bay pictures
    latest: tuple | None = field(default=None, repr=False)
    _latest_lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def set_latest(self, frame, vehicles, t: float) -> None:
        with self._latest_lock:
            self.latest = (frame, list(vehicles), t)

    def get_latest(self) -> tuple | None:
        with self._latest_lock:
            return self.latest

    def view(self, since: int = 0) -> dict:
        """JSON for GET /video-jobs/{id}. `since` returns only transitions after that index (for polling)."""
        return {
            'jobId': self.job_id, 'status': self.status, 'error': self.error, 'roiMask': self.mask, 'live': self.live,
            'framesProcessed': self.progress.frames_processed, 'totalFrames': self.progress.total_frames,
            'streamSeconds': self.progress.stream_s, 'bays': self.progress.states,
            'transitions': [_transition_json(t) for t in self.transitions[since:]],
            'transitionCount': len(self.transitions),
            'startedAt': self.started_at, 'finishedAt': self.finished_at,
        }


def _transition_json(t: Transition) -> dict:
    d = asdict(t)
    return {'bayId': d['bay_id'], 'fromState': d['from_state'], 'toState': d['to_state'], 'atSeconds': d['at'],
            'trackId': d['track_id'], 'overlap': d['overlap'], 'evidence': d['evidence']}


class JobManager:
    def __init__(self, detector):
        self.detector = detector
        self.jobs: dict[str, Job] = {}
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='video-job')

    def submit(self, job: Job) -> Job:
        if job.job_id in self.jobs and self.jobs[job.job_id].status in ('queued', 'running'):
            raise ValueError(f'Job {job.job_id} is already {self.jobs[job.job_id].status}.')
        self.jobs[job.job_id] = job
        self._pool.submit(self._run, job)
        return job

    def cancel(self, job_id: str) -> Job:
        job = self.jobs[job_id]
        job.stop.set()
        if job.status == 'queued':
            job.status, job.finished_at = 'cancelled', time.time()
        return job

    def _run(self, job: Job) -> None:
        if job.stop.is_set():
            return
        job.status, job.started_at = 'running', time.time()
        try:
            def on_progress(p: Progress) -> None:
                job.progress = p
            process_video(job.source, job.bays, self.detector, job.rules, job.sample_fps, mask=job.mask, live=job.live,
                          on_transition=job.transitions.append, on_progress=on_progress, on_frame=job.set_latest,
                          stop=job.stop)
            job.status = 'cancelled' if job.stop.is_set() else 'completed'
        except Exception as e:   # reported to the API; the service keeps running
            job.status, job.error = 'failed', str(e)[:500]
        finally:
            job.finished_at = time.time()

    def shutdown(self) -> None:
        for j in self.jobs.values():
            j.stop.set()
        self._pool.shutdown(wait=False, cancel_futures=True)
