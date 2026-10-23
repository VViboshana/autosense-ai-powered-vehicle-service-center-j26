# Learning from the workshop's own recordings: test (2026-10-23)

**Question:** does the retraining loop (acoustic/learning.py, `retrain.py --run`) make the model better on the kind of
recordings it is given, without making it worse elsewhere?

**Set-up:** the 7 usable AI Mechanic recordings (a normal engine idling, recorded *inside the cabin*; never used in
training, and badly recognised by version 1) were sent to the service as if technicians had confirmed them in the app
(`POST /sound/retrain`). Each recording was its own group. The run compared, on the same 5 grouped folds:

- **current**: recipe F trained without these recordings (what version 1 knows);
- **new**: recipe F trained with them.

Every clip is tested by a model that did not train on it (or on its group).

| Test clips | Current (macro F1 / accuracy) | New (macro F1 / accuracy) |
|---|---|---|
| All 1,268 clips | 0.864 / 0.871 | 0.865 / 0.872 |
| The same clips with workshop noise | 0.866 / 0.872 | 0.866 / 0.872 |
| The 7 in-cabin recordings | accuracy 3 of 7 (0.43) | accuracy **6 of 7 (0.86)** |

**Result:** seven recordings of a new recording condition raised accuracy on that condition from 43% to 86%, with no
loss on the rest. The whole run (fingerprinting 7 recordings, fair test, final training) took about 2.5 minutes on the
development laptop (Intel i7-8650U, CPU only). Activation and rollback switched versions without a restart.

**Limits:** 7 recordings of one class (normal idle) from one source: a demonstration of the loop, not a general
accuracy claim. Macro F1 on the 7 clips is low for both because only one true class is present. The test version was
deleted afterwards so that the app does not present these dataset clips as the workshop's own recordings. Full report:
`learning_test_in_cabin.json`.
