"""Number-plate reading: which vehicle is parked in a bay, so its job can be linked without guessing.

When a bay is (becoming) occupied, the parked vehicle's box is cut out of the camera frame and read with an
off-the-shelf OCR (RapidOCR, PaddleOCR models, Apache-2.0; no training of ours). Sri Lankan plates are reduced to their
core, the letters and digits that identify the vehicle: "WP KP-0683" -> "KP0683" (the small province code is the part
OCR most often misreads or drops, and matching ignores it). One reading is never trusted on its own: a bay's plate
counts only when the same core was read at least MIN_VOTES times and in most of the readings (PlateVotes).

Feasibility (20/10/2026, one clear front-on photo, shrunk step by step): read correctly down to about 50 px of plate
width; at 35 px one digit was wrong at confidence 0.74, which is why a single reading is never used.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import cv2
import numpy as np

# Sri Lankan province codes (as in shared/frontend/src/lib/format.ts formatPlate)
PROVINCES = {'WP', 'CP', 'SP', 'NP', 'EP', 'NW', 'NC', 'UP', 'UV', 'SG'}
MODERN = re.compile(r'^([A-Z]{2,3})(\d{4})$')     # KP-0683, CAB-4521
OLD = re.compile(r'^(\d{2,3})(\d{4})$')           # 19-1234, 250-1234
MIN_CONFIDENCE = 0.80    # OCR confidence below this is ignored
MIN_VOTES = 3            # the same core read at least this many times...
MIN_SHARE = 0.6          # ...and in at least this share of the usable readings
MAX_READS = 8            # stop reading a bay after this many attempts (CPU), unless still undecided


def plate_core(text: str) -> tuple[str, str] | None:
    """(core, display) for a plausible Sri Lankan plate, else None: 'WPKP-0683' -> ('KP0683', 'WP KP-0683')."""
    s = re.sub(r'[^A-Z0-9]', '', text.upper())
    province = ''
    if len(s) >= 8 and s[:2] in PROVINCES and MODERN.match(s[2:]):
        province, s = s[:2], s[2:]
    m = MODERN.match(s) or OLD.match(s)
    if not m:
        return None
    display = f'{m.group(1)}-{m.group(2)}'
    return s, f'{province} {display}' if province else display


@dataclass
class PlateVotes:
    """The readings of one bay's current vehicle, and the plate they agree on."""
    reads: int = 0                                       # attempts made
    cores: Counter = field(default_factory=Counter)      # core -> times read
    shown: dict = field(default_factory=dict)            # core -> fullest display text seen
    best_conf: dict = field(default_factory=dict)        # core -> highest confidence seen

    def add(self, reading: tuple[str, str, float] | None) -> None:
        self.reads += 1
        if reading is None:
            return
        core, display, conf = reading
        self.cores[core] += 1
        if len(display) > len(self.shown.get(core, '')):
            self.shown[core] = display
        self.best_conf[core] = max(conf, self.best_conf.get(core, 0.0))

    @property
    def stable(self) -> bool:
        if not self.cores:
            return False
        core, n = self.cores.most_common(1)[0]
        return n >= MIN_VOTES and n / sum(self.cores.values()) >= MIN_SHARE

    @property
    def done(self) -> bool:
        """Stop reading: the plate is settled, or enough attempts were made."""
        return self.stable or self.reads >= MAX_READS

    def view(self) -> dict | None:
        """For the job report; None until something was attempted."""
        if self.reads == 0:
            return None
        if not self.cores:
            return {'text': None, 'core': None, 'votes': 0, 'reads': self.reads, 'stable': False, 'done': self.done}
        core, n = self.cores.most_common(1)[0]
        return {'text': self.shown[core], 'core': core, 'votes': n, 'reads': self.reads,
                'confidence': round(self.best_conf[core], 2), 'stable': self.stable, 'done': self.done}


class PlateReader:
    """Reads the plate in one vehicle's picture. The OCR model is loaded on first use."""

    def __init__(self):
        from rapidocr_onnxruntime import RapidOCR   # optional dependency: see config.PLATES
        self._ocr = RapidOCR()

    def read(self, frame: np.ndarray, bbox: tuple[float, float, float, float]) -> tuple[str, str, float] | None:
        """(core, display, confidence) of the most confident plausible plate inside `bbox` (pixels), else None."""
        h, w = frame.shape[:2]
        x1, y1, x2, y2 = bbox
        px, py = (x2 - x1) * 0.08, (y2 - y1) * 0.08
        x1, y1 = int(max(0, x1 - px)), int(max(0, y1 - py))
        x2, y2 = int(min(w, x2 + px)), int(min(h, y2 + py))
        crop = frame[y1:y2, x1:x2]
        if crop.size == 0:
            return None
        if crop.shape[1] < 480:   # small vehicles in the picture: enlarge, OCR reads small text badly
            f = 480 / crop.shape[1]
            crop = cv2.resize(crop, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
        result, _ = self._ocr(crop)
        best = None
        for _box, text, conf in result or []:
            parsed = plate_core(text)
            if parsed and float(conf) >= MIN_CONFIDENCE and (best is None or float(conf) > best[2]):
                best = (parsed[0], parsed[1], float(conf))
        return best


def make_reader(setting: str) -> PlateReader | None:
    """auto: on when the OCR package is installed; on: required; off: never."""
    if setting == 'off':
        return None
    try:
        return PlateReader()
    except ImportError:
        if setting == 'on':
            raise
        return None
