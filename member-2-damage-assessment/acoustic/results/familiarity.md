# Odd-sound check: evidence

Model: 1 · thresholds: margin 0.109, distance 12.29

## Should be flagged

| Recording | Vehicle | Speech/music/tone | Distance | Flagged |
|---|---|---|---|---|
| white noise | 0.02 | 0.03 | 13.2 | yes |
| pink noise | 0.02 | 0.03 | 13.7 | yes |
| beep 1 kHz | 0.03 | 0.14 | 6.1 | yes |
| beeping (on/off 2 Hz) | 0.04 | 0.29 | 5.9 | yes |
| chord (music-like) | 0.02 | 0.14 | 5.8 | yes |
| speech | 0.02 | 0.65 | 7.0 | yes |
| AI Mechanic Background Noise.2qqg6i7 | 0.16 | 0.03 | 4.8 | **no** |
| AI Mechanic Background Noise.2qqg77a | 0.07 | 0.04 | 4.7 | **no** |
| AI Mechanic Background Noise.2qqg7sb | 0.16 | 0.03 | 4.9 | **no** |
| AI Mechanic Background Noise.2qqgafi | 0.17 | 0.03 | 4.5 | **no** |
| AI Mechanic background noise.2qsjj94 | 0.03 | 0.09 | 6.6 | **no** |

6 of 11 flagged.

## Should pass (real recordings)

Up to 15 recordings per class (these were in training, so this checks the rule does not flag real faults; the held-out rate is set by the 99th-percentile thresholds).

| Class | Recordings | Flagged |
|---|---|---|
| bad_ignition | 15 | 1 |
| dead_battery | 15 | 3 |
| low_oil | 15 | 0 |
| misfire | 15 | 0 |
| normal_brakes | 15 | 0 |
| normal_idle | 15 | 0 |
| normal_start | 15 | 0 |
| power_steering | 15 | 5 |
| serpentine_belt | 15 | 1 |
| tappet | 15 | 0 |
| worn_brakes | 15 | 4 |
| normal_idle (AI Mechanic, in-cabin, never trained on) | 7 | 1 |

15 of 172 real recordings flagged (8.7%).
