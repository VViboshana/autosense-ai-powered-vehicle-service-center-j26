import cv2
import numpy as np
import pytest

from app.detector import Vehicle
from app.pipeline import BayConfig, process_video, read_frame
from app.state_machine import Rules

W, H, FPS = 320, 180, 10
BAY = BayConfig('B1', [[0.25, 0.25], [0.5, 0.25], [0.5, 0.75], [0.25, 0.75]])   # x 80-160, y 45-135 px
OTHER = BayConfig('B2', [[0.6, 0.25], [0.85, 0.25], [0.85, 0.75], [0.6, 0.75]])


class BlobDetector:
    """Stands in for YOLO: every white block in the frame is one vehicle."""
    def track(self, image, confidence=0.25, reset=False):
        n, _, stats, _ = cv2.connectedComponentsWithStats((image[:, :, 0] > 128).astype(np.uint8))
        return [Vehicle((float(x), float(y), float(x + w), float(y + h)), 0.9, i)
                for i, (x, y, w, h, _) in enumerate(stats[1:], start=1)]


def make_video(path, seconds, car_at):
    """`car_at(t)` -> x offset of a 70x80 px car at time t, or None when no car is visible."""
    out = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*'MJPG'), FPS, (W, H))
    for i in range(seconds * FPS):
        frame = np.zeros((H, W, 3), np.uint8)
        x = car_at(i / FPS)
        if x is not None:
            frame[50:130, x:x + 70] = 255
        out.write(frame)
    out.release()
    return str(path)


def test_car_parking_then_leaving_gives_two_confirmed_transitions(tmp_path):
    video = make_video(tmp_path / 'park.avi', 16, lambda t: 85 if 2 <= t < 9 else None)
    seen = []
    progress = process_video(video, [BAY, OTHER], BlobDetector(), Rules(), sample_fps=2, on_transition=seen.append)
    # car visible 2-9 s: occupied confirmed 3 s after it arrives, free 5 s after it leaves
    assert [(t.from_state, t.to_state, t.at) for t in seen if t.bay_id == 'B1'] == [
        ('uncertain', 'occupied', 5.0), ('occupied', 'free', 14.0)]
    assert next(t for t in seen if t.to_state == 'occupied').track_id is not None
    assert [(t.to_state, t.at) for t in seen if t.bay_id == 'B2'] == [('free', 5.0)]
    assert progress.frames_processed == 32 and progress.states['B1']['state'] == 'free'


def test_car_driving_through_does_not_occupy_the_bay(tmp_path):
    # crosses the whole frame in 3 s: inside the bay for well under the 3 s confirmation
    video = make_video(tmp_path / 'pass.avi', 12, lambda t: int((t - 6) * 100) if 6 <= t < 9 else None)
    seen = []
    process_video(video, [BAY], BlobDetector(), Rules(), sample_fps=2, on_transition=seen.append)
    assert [t.to_state for t in seen] == ['free']


class SeenDetector(BlobDetector):
    """Remembers how many vehicles it was shown in each frame."""
    def __init__(self):
        self.counts = []

    def track(self, image, confidence=0.25, reset=False):
        vehicles = super().track(image, confidence, reset)
        self.counts.append(len(vehicles))
        return vehicles


def test_masking_hides_vehicles_outside_the_bays_only(tmp_path):
    # one car parked in B1 (x 85-155) the whole time, another outside every bay (x 250-320)
    out = cv2.VideoWriter(str(tmp_path / 'two.avi'), cv2.VideoWriter_fourcc(*'MJPG'), FPS, (W, H))
    for _ in range(8 * FPS):
        frame = np.zeros((H, W, 3), np.uint8)
        frame[50:130, 85:155] = 255
        frame[50:130, 250:320] = 255
        out.write(frame)
    out.release()
    results = {}
    for mask in (False, True):
        seen, detector = [], SeenDetector()
        process_video(str(tmp_path / 'two.avi'), [BAY], detector, Rules(), sample_fps=2, mask=mask,
                      on_transition=seen.append)
        results[mask] = ([(t.to_state, t.at) for t in seen], set(detector.counts))
    assert results[False][1] == {2} and results[True][1] == {1}   # the outside car is no longer seen
    assert results[True][0] == results[False][0] == [('occupied', 3.0)]   # the bay's result is unchanged


def test_stop_event_ends_processing_early(tmp_path):
    import threading
    video = make_video(tmp_path / 'long.avi', 10, lambda t: None)
    stop = threading.Event()
    stop.set()
    assert process_video(video, [BAY], BlobDetector(), stop=stop).frames_processed == 0


def test_unreadable_source_is_reported(tmp_path):
    with pytest.raises(ValueError):
        process_video(str(tmp_path / 'missing.mp4'), [BAY], BlobDetector())
    with pytest.raises(ValueError):
        read_frame(str(tmp_path / 'missing.mp4'))


def test_read_frame_returns_the_requested_moment(tmp_path):
    video = make_video(tmp_path / 'snap.avi', 4, lambda t: 85 if t >= 2 else None)
    assert read_frame(video, 0.0).max() < 50 and read_frame(video, 3.0).max() > 200


def test_live_replay_runs_in_real_time_and_loops_until_stopped(tmp_path):
    import threading
    video = make_video(tmp_path / 'live.avi', 1, lambda t: 85)     # 1 s long, car always in B1
    stop, frames = threading.Event(), []
    threading.Timer(2.6, stop.set).start()
    progress = process_video(video, [BAY], BlobDetector(), Rules(), sample_fps=4, live=True, stop=stop,
                             on_frame=lambda f, v, t: frames.append((t, len(v))))
    times = [t for t, _ in frames]
    assert progress.total_frames is None                     # live: no end
    assert times == sorted(times) and 2.0 <= times[-1] < 2.8   # wall-clock time, kept going past the 1 s video
    assert 6 <= len(frames) <= 12                            # paced to about 4 samples per second
    assert all(n == 1 for _, n in frames)                    # the car is seen in every loop
    assert progress.states['B1']['state'] == 'uncertain'     # 3 s confirmation not reached in 2.6 s


def test_live_replay_needs_a_recorded_video(tmp_path):
    with pytest.raises(ValueError):
        process_video(str(tmp_path / 'missing.mp4'), [BAY], BlobDetector(), live=True)
