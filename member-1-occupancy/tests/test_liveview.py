import cv2
import numpy as np

from app.detector import Vehicle
from app.liveview import render


def decode(jpg: bytes) -> np.ndarray:
    return cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)


def test_whole_frame_is_scaled_to_the_requested_width():
    img = decode(render(np.zeros((720, 1280, 3), np.uint8), [], width=320))
    assert img.shape[:2] == (180, 320)


def test_bay_view_is_a_4_by_3_crop_around_the_bay_with_outlines():
    frame = np.zeros((720, 1280, 3), np.uint8)
    bay = [[0.5, 0.5], [0.55, 0.5], [0.55, 0.55], [0.5, 0.55]]
    img = decode(render(frame, [Vehicle((650.0, 365.0, 700.0, 390.0), 0.9)], bay, width=400))
    assert img.shape[:2] == (300, 400)
    assert img.max() > 200        # the white outlines are drawn


def test_bay_at_the_edge_stays_inside_the_frame():
    frame = np.full((720, 1280, 3), 80, np.uint8)
    img = decode(render(frame, [], [[0.0, 0.0], [0.03, 0.0], [0.03, 0.03], [0.0, 0.03]], width=400))
    assert img.shape[1] == 400 and img.shape[0] > 0


def test_bay_view_stays_inside_its_bounds():
    # a 1920x720 picture of 3 x 2 panels: a bay near the top of the bottom-left panel must not show the panel above
    frame = np.zeros((720, 1920, 3), np.uint8)
    frame[:360] = 200                                   # the top row of panels is bright
    bay = [[0.10, 0.52], [0.18, 0.52], [0.18, 0.62], [0.10, 0.62]]
    img = decode(render(frame, [], bay, width=400, bounds=[0, 0.5, 1 / 3, 1]))
    assert img.shape[:2] == (300, 400)
    assert np.median(img) < 50                          # only the dark bottom-left panel (plus the outline)
