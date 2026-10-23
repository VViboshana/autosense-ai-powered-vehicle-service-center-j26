# Sound inspection results (2026-10-23)

1261 clips (3308 windows of 1.5 s) from car_diagnostics, sri_lanka; 5-fold grouped cross-validation (each clip tested once, twins kept together). "Noisy" = the same test clips with workshop-like noise added (5-20 dB).

| | Model | Clean acc. | Clean macro F1 | Noisy acc. | Noisy macro F1 | Car Diag. acc. | Sri Lanka acc. |
|---|---|---|---|---|---|---|---|
| A | MFCC + random forest (classic baseline) | 0.850 | 0.834 | 0.588 | 0.504 | 0.830 | 0.910 |
| B | PANNs + logistic regression | 0.857 | 0.850 | 0.833 | 0.826 | 0.846 | 0.891 |
| C | MFCC + PANNs + logistic regression | 0.878 | 0.866 | 0.841 | 0.838 | 0.868 | 0.907 |
| D | PANNs + small neural network | 0.860 | 0.850 | 0.822 | 0.808 | 0.848 | 0.894 |
| E | PANNs + logistic regression + noise training | 0.856 | 0.853 | 0.859 | 0.855 | 0.849 | 0.875 |
| F | MFCC + PANNs + logistic regression + noise training **(chosen)** | 0.880 | 0.872 | 0.870 | 0.863 | 0.877 | 0.891 |
| G | PANNs + small neural network + noise training | 0.856 | 0.844 | 0.860 | 0.848 | 0.847 | 0.881 |

Choice rule (fixed in advance): highest average of clean and noisy macro F1.

Chosen model with an ordinary (ungrouped) split: accuracy 0.889, macro F1 0.887 -- the gap to the grouped score is how much twins would have inflated the result.

## Chosen model (F) per class, clean test

| Class | Situation | Precision | Recall | F1 | Clips |
|---|---|---|---|---|---|
| normal_start | starting | 0.87 | 0.87 | 0.87 | 61 |
| bad_ignition | starting | 0.83 | 0.85 | 0.84 | 62 |
| dead_battery | starting | 0.89 | 0.86 | 0.88 | 57 |
| normal_idle | idling | 0.93 | 0.91 | 0.92 | 344 |
| low_oil | idling | 0.90 | 0.84 | 0.87 | 107 |
| power_steering | idling | 0.83 | 0.87 | 0.85 | 129 |
| serpentine_belt | idling | 0.91 | 0.88 | 0.89 | 174 |
| misfire | idling | 0.77 | 0.85 | 0.81 | 108 |
| tappet | idling | 0.96 | 0.98 | 0.97 | 66 |
| normal_brakes | braking | 0.85 | 0.86 | 0.85 | 77 |
| worn_brakes | braking | 0.85 | 0.84 | 0.85 | 76 |

## Chosen model (F) confusion matrix, clean test (rows = true, columns = predicted)

| true \ pred | normal_start | bad_ignition | dead_battery | normal_idle | low_oil | power_steering | serpentine_belt | misfire | tappet | normal_brakes | worn_brakes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| normal_start | 53 | 5 | 3 | . | . | . | . | . | . | . | . |
| bad_ignition | 6 | 53 | 3 | . | . | . | . | . | . | . | . |
| dead_battery | 2 | 6 | 49 | . | . | . | . | . | . | . | . |
| normal_idle | . | . | . | 313 | 3 | 11 | . | 17 | . | . | . |
| low_oil | . | . | . | 7 | 90 | 3 | 2 | 5 | . | . | . |
| power_steering | . | . | . | 2 | 2 | 112 | 11 | 2 | . | . | . |
| serpentine_belt | . | . | . | 4 | 4 | 9 | 153 | 4 | . | . | . |
| misfire | . | . | . | 10 | 1 | . | 2 | 92 | 3 | . | . |
| tappet | . | . | . | 1 | . | . | . | . | 65 | . | . |
| normal_brakes | . | . | . | . | . | . | . | . | . | 66 | 11 |
| worn_brakes | . | . | . | . | . | . | . | . | . | 12 | 64 |

## Chosen model (F): answer only when confident (clean test)

| Confidence at least | Clips answered | Accuracy on those |
|---|---|---|
| 0.5 | 99.0% | 0.885 |
| 0.6 | 96.2% | 0.893 |
| 0.7 | 93.3% | 0.907 |
| 0.8 | 89.3% | 0.917 |

## Recordings from another source (never used in training)

AI Mechanic normal-engine clips (recorded inside the cabin): 2 of 7 called normal_idle; predictions: {'normal_idle': 2, 'power_steering': 3, 'serpentine_belt': 2}.
