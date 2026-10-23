"""Reading a recording into the form every model sees: mono, 32 kHz, band-limited, same loudness, cut into windows."""
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfiltfilt

SAMPLE_RATE = 32000   # PANNs CNN14 was trained on 32 kHz audio
WINDOW_S = 1.5        # the Car Diagnostics clips are 1.5-1.7 s, so every recording is judged in 1.5 s pieces
HOP_S = 0.75          # longer recordings: a new window every 0.75 s (windows overlap by half)
# Some source recordings were made at 24 kHz, so they have no sound above 12 kHz. Cutting everyone at 11 kHz stops the
# model from learning "no high sound = this class" (a recording-device clue, not a fault).
LOWPASS_HZ = 11000
TARGET_RMS = 0.05     # every recording is scaled to the same loudness, so volume is not a clue either
SILENT_PEAK = 1e-3    # a recording whose loudest sample is below this is treated as silent

_LOWPASS = butter(8, LOWPASS_HZ, btype='low', fs=SAMPLE_RATE, output='sos')


def load(path) -> np.ndarray:
    """Mono float32 at SAMPLE_RATE, band-limited, NOT yet loudness-normalised (so silence can still be detected)."""
    x, sr = sf.read(str(path), dtype='float32', always_2d=True)
    return prepare(x.mean(axis=1), sr)


def prepare(x: np.ndarray, sr: int) -> np.ndarray:
    if sr != SAMPLE_RATE:
        g = gcd(sr, SAMPLE_RATE)
        x = resample_poly(x, SAMPLE_RATE // g, sr // g)
    return sosfiltfilt(_LOWPASS, x).astype(np.float32)


def normalise(x: np.ndarray) -> np.ndarray:
    rms = float(np.sqrt(np.mean(x ** 2)))
    return np.clip(x * (TARGET_RMS / rms), -1, 1).astype(np.float32) if rms > 0 else x


def add_noise(x: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    """Workshop-like background: pink noise (more low hum than hiss, like machines and voices) at the given
    signal-to-noise ratio. 20 dB = quiet room, 10 dB = busy workshop, 5 dB = very noisy."""
    white = np.fft.rfft(rng.standard_normal(len(x)))
    pink = np.fft.irfft(white / np.sqrt(np.arange(1, len(white) + 1)), n=len(x))
    signal_power, noise_power = np.mean(x ** 2), np.mean(pink ** 2)
    return (x + pink * np.sqrt(signal_power / (noise_power * 10 ** (snr_db / 10)))).astype(np.float32)


def windows(x: np.ndarray) -> np.ndarray:
    """[n, WINDOW] array. A recording shorter than one window is padded by repeating it (silence would look odd)."""
    size, hop = int(WINDOW_S * SAMPLE_RATE), int(HOP_S * SAMPLE_RATE)
    x = normalise(x)
    if len(x) < size:
        x = np.tile(x, size // max(len(x), 1) + 1)[:size]
    starts = range(0, len(x) - size + 1, hop)
    return np.stack([x[s:s + size] for s in starts])
