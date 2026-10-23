/*
    Measured test-set results of the damage models, stored with the model version (app.model_versions.metrics).
    Applied on every `npm run db:migrate`. A version's metrics are measurements: they are only ever replaced by a new
    measurement of the same version (here, the source file named below), never edited by hand in the app.

    AutoSense Damage Detection V1 (training run expA_yolo11n_640): YOLO11n-seg, 640 px, 100 epochs on CarDD (train 2816 / val 810 photos), evaluated once on the
    CarDD test split (374 photos, 785 damage regions). Source: Kaggle notebook autosense-damage-yolo11-training,
    version 2, Cell 5 output runs/expA_test_results.json (segmentation mask metrics).
*/
INSERT INTO app.model_versions (component, name, version, metrics, notes)
VALUES (
    'damage', 'yolo11-seg-cardd', 'AutoSense Damage Detection V1',
    '{
       "split": "CarDD test",
       "images": 374,
       "regions": 785,
       "mask": { "precision": 0.7900, "recall": 0.6904, "mAP50": 0.7381, "mAP50_95": 0.5339 },
       "perClassMaskMAP50_95": {
         "dent": 0.2960, "scratch": 0.2735, "crack": 0.1913,
         "glass_shatter": 0.9044, "lamp_broken": 0.6797, "tire_flat": 0.8582
       },
       "source": "runs/expA_test_results.json"
     }',
    'Training run expA_yolo11n_640 (Experiment A): YOLO11n-seg at 640 px, trained on Kaggle (T4), 100 epochs, seed 0'
)
ON CONFLICT (component, name, version) DO UPDATE SET metrics = EXCLUDED.metrics, notes = EXCLUDED.notes;
