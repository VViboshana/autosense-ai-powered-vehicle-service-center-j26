"""Photo quality check, run before the model: a blurry, dark or tiny photo gives unreliable detections."""
import cv2
import numpy as np

from . import config


def check_quality(image: np.ndarray) -> dict:
    """image: BGR array. Returns { passed, blurVar, brightness, warnings[] } (stored in damage.inspection_images.quality)."""
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    height, width = grey.shape

    # Sharp photos have strong edges, so the Laplacian (edge filter) output varies a lot; blur flattens it.
    blur_var = float(cv2.Laplacian(grey, cv2.CV_64F).var())
    brightness = float(grey.mean())

    warnings = []
    if min(width, height) < config.MIN_SIDE_PX:
        warnings.append(f'Low resolution ({width}x{height}); use at least {config.MIN_SIDE_PX} px on the short side.')
    if blur_var < config.BLUR_MIN:
        warnings.append('The photo looks blurry; hold the camera still and retake it.')
    low, high = config.BRIGHTNESS_RANGE
    if brightness < low:
        warnings.append('The photo is too dark; add light or move the vehicle.')
    elif brightness > high:
        warnings.append('The photo is too bright; avoid direct sunlight or flash glare.')

    return {'passed': not warnings, 'blurVar': round(blur_var, 1), 'brightness': round(brightness, 1), 'warnings': warnings}
