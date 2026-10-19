"""Per-bay occupancy state with temporal confirmation (hysteresis).

Each sampled frame gives every bay one observation: the association score of its best-matching vehicle (see
association.py), or nothing when no frame arrived. A single frame never changes a bay's state. A change is
committed only when the contrary evidence has lasted long enough:

  free     -> occupied   presence held for `confirm_occupied_s` (default 3 s, setting occupancy.rules)
  occupied -> free       absence  held for `confirm_free_s`     (default 5 s; leaving is confirmed more slowly)
  any      -> uncertain  no observation for `stale_after_s` (camera feed lost or stalled, NFR-04)
  uncertain -> free/occupied   the same confirmation rule as above, starting from no committed state

Two thresholds give score hysteresis: a bay becomes "present" at `threshold` but only stops being present below
`release_threshold`, so a score hovering around one value cannot flip the evidence every frame.

Brief contrary blips shorter than `tolerance_s` do not reset a running confirmation, so one missed detection in the
middle of a car driving in does not restart the 3-second clock. In return, a change is committed only when at least
`min_support` of the samples over the confirmation period supported it; otherwise the period starts again. Without
this, a parked car that is missed once every second or so would slowly be "confirmed" as gone.

States: 'free', 'occupied', 'uncertain' (no reliable evidence). A change that is being confirmed is reported as
`confirming` on the snapshot, not as a state: every flicker would otherwise create history events and distort the
false-transition metrics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

State = Literal['free', 'occupied', 'uncertain']


@dataclass(frozen=True)
class Rules:
    threshold: float = 0.4            # occupancy.rules.overlapThreshold
    release_threshold: float = 0.3    # must be <= threshold
    confirm_occupied_s: float = 3.0   # occupancy.rules.confirmOccupiedSeconds
    confirm_free_s: float = 5.0       # occupancy.rules.confirmFreeSeconds
    tolerance_s: float = 1.0          # contrary blips up to this long do not reset a confirmation
    min_support: float = 0.8          # share of samples over the confirmation period that must support the change
    stale_after_s: float = 10.0       # no observation for this long -> uncertain

    def __post_init__(self) -> None:
        if not 0 <= self.release_threshold <= self.threshold <= 1:
            raise ValueError('Need 0 <= release_threshold <= threshold <= 1.')
        if not 0.5 < self.min_support <= 1:
            raise ValueError('min_support must be in (0.5, 1].')
        if min(self.confirm_occupied_s, self.confirm_free_s, self.stale_after_s) <= 0 or self.tolerance_s < 0:
            raise ValueError('Durations must be positive.')

    @classmethod
    def from_settings(cls, s: dict) -> 'Rules':
        """Builds rules from the `occupancy.rules` setting (camelCase keys); missing keys keep their defaults."""
        keys = {'overlapThreshold': 'threshold', 'releaseThreshold': 'release_threshold',
                'confirmOccupiedSeconds': 'confirm_occupied_s', 'confirmFreeSeconds': 'confirm_free_s',
                'toleranceSeconds': 'tolerance_s', 'minSupport': 'min_support', 'staleAfterSeconds': 'stale_after_s'}
        kw = {keys[k]: float(v) for k, v in s.items() if k in keys}
        if 'release_threshold' not in kw and 'threshold' in kw:
            kw['release_threshold'] = min(cls.release_threshold, kw['threshold'])
        return cls(**kw)


@dataclass(frozen=True)
class Transition:
    bay_id: str
    from_state: State
    to_state: State
    at: float                 # seconds (stream time) when the change was committed
    track_id: int | None
    overlap: float | None     # score of the matched vehicle at commit time
    evidence: str             # e.g. 'present 6/6 samples over 3.0s'


@dataclass
class _Run:
    """The contrary evidence currently being confirmed."""
    target: State
    started: float
    last_support: float
    support: int = 0
    total: int = 0


@dataclass
class BayTracker:
    bay_id: str
    rules: Rules = field(default_factory=Rules)
    state: State = 'uncertain'
    since: float | None = None
    track_id: int | None = None
    overlap: float | None = None
    _present: bool | None = None       # evidence after hysteresis
    _last_seen: float | None = None
    _run: _Run | None = None

    @property
    def confirming(self) -> State | None:
        return self._run.target if self._run else None

    def observe(self, t: float, score: float | None, track_id: int | None = None) -> Transition | None:
        """Feeds one sample at stream time `t` (seconds, non-decreasing). `score` None = no frame for this bay."""
        if self._last_seen is not None and t < self._last_seen:
            raise ValueError('Observations must arrive in time order.')
        if score is None:
            return self.tick(t)
        self._last_seen = t
        r = self.rules
        if self._present:
            self._present = score >= r.release_threshold
        else:
            self._present = score >= r.threshold
        if self._present:
            self.track_id, self.overlap = track_id, round(score, 3)
        target: State = 'occupied' if self._present else 'free'

        if target == self.state:
            # Evidence agrees with the committed state. A short blip keeps a running confirmation alive.
            if self._run and t - self._run.last_support > r.tolerance_s:
                self._run = None
            elif self._run:
                self._run.total += 1
            return None

        if self._run is None or self._run.target != target:
            self._run = _Run(target, t, t)
        self._run.support += 1
        self._run.total += 1
        self._run.last_support = t
        needed = r.confirm_occupied_s if target == 'occupied' else r.confirm_free_s
        if t - self._run.started >= needed:
            run = self._run
            if run.support / run.total < r.min_support:
                self._run = _Run(target, t, t, 1, 1)    # too mixed to be a real change: start the period again
                return None
            label = 'present' if target == 'occupied' else 'absent'
            return self._commit(target, t, f'{label} {run.support}/{run.total} samples over {t - run.started:.1f}s')
        return None

    def tick(self, t: float) -> Transition | None:
        """Call regularly (also when no frame arrived) so a lost feed turns the bay uncertain."""
        if self.state == 'uncertain' or self._last_seen is None:
            return None
        if t - self._last_seen >= self.rules.stale_after_s:
            self._run = None
            self._present = None
            return self._commit('uncertain', t, f'no frame for {t - self._last_seen:.1f}s')
        return None

    def _commit(self, to: State, t: float, evidence: str) -> Transition:
        tr = Transition(self.bay_id, self.state, to, t,
                        self.track_id if to == 'occupied' else None,
                        self.overlap if to == 'occupied' else None, evidence)
        self.state, self.since, self._run = to, t, None
        if to != 'occupied':
            self.track_id = self.overlap = None
        return tr
