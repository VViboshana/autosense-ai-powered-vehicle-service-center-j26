import numpy as np
import pytest

import prepare_pklot
from app import config, roi

# Two PKLot-like slots (pixels) on a 1280x720 frame, the training size
SLOTS = [[(100, 200), (220, 190), (230, 300), (110, 310)], [(600, 400), (700, 400), (700, 500), (600, 500)]]


def test_mask_matches_the_training_mask_exactly():
    # the service must grey out exactly what training did, or the fine-tuned model sees a different kind of image
    assert roi.margin_for(1280, 720) == prepare_pklot.MASK_MARGIN_PX
    ours = roi.roi_mask(SLOTS, 1280, 720, roi.margin_for(1280, 720))
    assert np.array_equal(ours, prepare_pklot.space_mask(SLOTS, 1280, 720))
    img = np.random.default_rng(0).integers(0, 256, (720, 1280, 3), dtype=np.uint8)
    assert roi.MASK_FILL == prepare_pklot.MASK_FILL
    assert np.array_equal(roi.apply_mask(img, ours), prepare_pklot.apply_mask(img, ours))


def test_outside_the_bays_is_grey_and_inside_is_unchanged():
    img = np.full((720, 1280, 3), 255, np.uint8)
    out = roi.apply_mask(img, roi.bay_mask([[(0.5, 0.5), (0.6, 0.5), (0.6, 0.6), (0.5, 0.6)]], 1280, 720))
    assert (out[380, 700] == 255).all()                   # inside the bay
    assert (out[360 - 8, 700] == 255).all()               # inside the 12 px margin
    assert (out[360 - 20, 700] == 114).all()              # beyond the margin
    assert (out[0, 0] == 114).all() and (img == 255).all()   # the original frame is not changed


@pytest.mark.parametrize('size, margin', [((1280, 720), 12), ((1920, 1080), 18), ((640, 480), 6), ((720, 1280), 7),
                                          ((320, 180), 4)])
def test_margin_is_12_per_1280_px_of_width_and_at_least_4(size, margin):
    assert roi.margin_for(*size, base=12) == margin


def test_a_zero_margin_switches_the_margin_off():
    assert roi.margin_for(1920, 1080, base=0) == 0


@pytest.mark.parametrize('setting, placeholder, expected', [
    ('auto', False, True), ('auto', True, False), ('on', True, True), ('off', False, False)])
def test_default_follows_the_setting_and_the_model(monkeypatch, setting, placeholder, expected):
    monkeypatch.setattr(config, 'ROI_MASK', setting)
    assert roi.mask_default(placeholder) is expected
