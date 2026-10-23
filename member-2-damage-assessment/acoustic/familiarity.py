"""Is this a recording the sound model can judge? Two checks, both from PANNs, fitted on the training recordings:

1. Not a vehicle: PANNs also names what it hears (527 AudioSet sound types). When it hears speech, music or a tone
   more strongly than any vehicle or mechanical sound, the fault model would still pick a fault, confidently and wrongly.
   Measured: real faults often score LOW on "vehicle" (a flat battery clicks, a worn belt squeals), so a low vehicle
   score alone would flag real faults; the rule is "something else clearly louder than the vehicle".
2. Distance: how far the recording's fingerprint is from the training recordings (Mahalanobis distance after PCA).
   Catches sounds unlike anything in training (e.g. pure static or hiss).

A recording failing either check is "unfamiliar": the service still answers, but marks it not sure and warns.
Limit (measured): an engine recorded from inside the cabin still sounds like an engine, so it passes; that case is
handled by the recording instructions, not by this check.
"""
import numpy as np
from sklearn.decomposition import PCA

# AudioSet classes that mean "vehicle or mechanical sound" (names in panns_inference.config.labels)
VEHICLE_LABELS = [
    'Vehicle', 'Motor vehicle (road)', 'Car', 'Skidding', 'Tire squeal', 'Car passing by', 'Air brake', 'Engine',
    'Light engine (high frequency)', 'Medium engine (mid frequency)', 'Heavy engine (low frequency)',
    'Engine knocking', 'Engine starting', 'Idling', 'Accelerating, revving, vroom', 'Mechanisms', 'Ratchet, pawl',
    'Tick', 'Squeal', 'Whir', 'Rattle', 'Clatter',
]
# ... and what a wrong recording usually is instead: people talking, music, a phone or a beep, silence
OTHER_LABELS = [
    'Speech', 'Male speech, man speaking', 'Female speech, woman speaking', 'Child speech, kid speaking', 'Conversation',
    'Narration, monologue', 'Babbling', 'Speech synthesizer', 'Hubbub, speech noise, speech babble', 'Singing', 'Whistling',
    'Music', 'Musical instrument', 'Telephone', 'Ringtone', 'Television', 'Radio', 'Beep, bleep', 'Sine wave', 'Silence',
]
PCA_COMPONENTS = 40
# Threshold: how much louder "other" may be than "vehicle" in 95% of training recordings. Not 99%: measured, about 5% of
# the training clips (cut from online videos) carry background music or speech, which would set the bar too high to
# catch a beep or music (see results/familiarity.md).
OTHER_PERCENTILE = 95
DISTANCE_PERCENTILE = 99   # threshold: the distance only 1% of (unseen) training recordings exceed


def label_indices(labels: list[str], names: list[str]) -> list[int]:
    return [labels.index(name) for name in names]


def strongest(tags: np.ndarray, indices: list[int]) -> np.ndarray:
    """Per window: the strongest of the given AudioSet classes (0-1)."""
    return tags[:, indices].max(axis=1)


class Familiarity:
    """Fitted on clip fingerprints (mean PANNs embedding of a clip's windows) and clip "other minus vehicle" margins."""

    def fit(self, embeddings: np.ndarray, margins: np.ndarray, distance_threshold: float):
        self.pca = PCA(n_components=PCA_COMPONENTS, whiten=True, random_state=0).fit(embeddings)
        self.margin_threshold = float(max(0.05, np.percentile(margins, OTHER_PERCENTILE))) if len(margins) else 0.3
        self.distance_threshold = float(distance_threshold)
        return self

    def distance(self, embeddings: np.ndarray) -> np.ndarray:
        return np.sqrt((self.pca.transform(np.atleast_2d(embeddings)) ** 2).sum(axis=1))

    def check(self, embedding: np.ndarray, vehicle: float, other: float) -> dict:
        distance = float(self.distance(embedding)[0])
        reasons = []
        if other - vehicle > self.margin_threshold:
            reasons.append('it sounds more like speech, music or a tone than a vehicle')
        if distance > self.distance_threshold:
            reasons.append('it sounds unlike the recordings the model learned from')
        return {'familiar': not reasons, 'vehicleScore': round(vehicle, 3), 'otherScore': round(other, 3),
                'distance': round(distance, 2), 'marginThreshold': round(self.margin_threshold, 3),
                'distanceThreshold': round(self.distance_threshold, 2), 'reasons': reasons}
