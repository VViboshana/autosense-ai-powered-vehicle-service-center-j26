"""Feature mapping, variant selection, and model inference."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd

from .model_loader import ModelBundle, VariantArtifacts
from .schemas import ForecastRequest

BASIC_COLUMNS = ["Car_Make", "Car_Model", "Vehicle_Year", "Problem Description", "Severity"]
ENRICHED_COLUMNS = BASIC_COLUMNS + ["Service History", "ECU Data", "Diagnosis"]
UNKNOWN = "Unknown"
SUPPORTED_CATEGORIES = ("Battery", "Brakes", "Electrical", "Engine", "Transmission")


def meaningful(value: Any) -> bool:
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return bool(value.strip()) and value.strip().lower() != UNKNOWN.lower()
    if isinstance(value, (dict, list, tuple)):
        return any(meaningful(item) for item in value.values() if isinstance(value, dict)) if isinstance(value, dict) else any(meaningful(item) for item in value)
    return True


def feature_value(value: Any) -> str:
    if not meaningful(value):
        return UNKNOWN
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return str(value).strip()


def select_model_variant(request: ForecastRequest) -> str:
    history = request.service_history.summary if request.service_history else None
    diagnostics = request.diagnostics
    if meaningful(history) or (diagnostics and (meaningful(diagnostics.ecu_data) or meaningful(diagnostics.diagnosis))):
        return "enriched"
    return "basic"


def information_sources(request: ForecastRequest) -> dict[str, bool]:
    vehicle = request.vehicle
    report = request.customer_report
    history = request.service_history.summary if request.service_history else None
    diagnostics = request.diagnostics
    return {
        "customerReport": meaningful(report.problem_description) and meaningful(report.severity),
        "vehicleDetails": meaningful(vehicle.make) and meaningful(vehicle.model) and vehicle.year is not None,
        "serviceHistory": meaningful(history),
        "ecuDiagnostics": bool(diagnostics and meaningful(diagnostics.ecu_data)),
        "technicianDiagnosis": bool(diagnostics and meaningful(diagnostics.diagnosis)),
        "inspectionReport": bool(request.inspection and request.inspection.linked),
    }


def feature_frame(request: ForecastRequest, variant: str) -> pd.DataFrame:
    diagnostics = request.diagnostics
    values = {
        "Car_Make": request.vehicle.make,
        "Car_Model": request.vehicle.model,
        "Vehicle_Year": request.vehicle.year,
        "Problem Description": request.customer_report.problem_description,
        "Severity": request.customer_report.severity,
        "Service History": feature_value(request.service_history.summary if request.service_history else None),
        "ECU Data": feature_value(diagnostics.ecu_data if diagnostics else None),
        "Diagnosis": feature_value(diagnostics.diagnosis if diagnostics else None),
    }
    columns = BASIC_COLUMNS if variant == "basic" else ENRICHED_COLUMNS
    return pd.DataFrame([{column: values[column] for column in columns}], columns=columns)


def predict_category(request: ForecastRequest, bundle: ModelBundle) -> tuple[str, dict[str, float], float]:
    variant = select_model_variant(request)
    artifacts: VariantArtifacts = getattr(bundle, variant)
    if not artifacts.available:
        raise RuntimeError(f"{variant} model is unavailable")
    frame = feature_frame(request, variant)
    model_frame = frame
    if artifacts.preprocessor is not None:
        model_frame = artifacts.preprocessor.transform(frame)
        if model_frame.shape[1] != 169:
            raise RuntimeError(f"enriched preprocessor produced {model_frame.shape[1]} features; expected 169")
    encoded_prediction = int(artifacts.model.predict(model_frame)[0])
    label = str(artifacts.encoder.inverse_transform([encoded_prediction])[0])
    probabilities = artifacts.model.predict_proba(model_frame)[0]
    classes = [str(value) for value in artifacts.encoder.classes_]
    model_classes = getattr(artifacts.model, "classes_", range(len(probabilities)))
    scores = {str(artifacts.encoder.inverse_transform([int(class_id)])[0]): float(probability) for class_id, probability in zip(model_classes, probabilities)}
    return label, scores, float(scores[label])


def get_candidate_tasks(bundle: ModelBundle, category: str, limit: int = 8) -> list[dict[str, Any]]:
    if bundle.task_catalog is None:
        return []
    rows = bundle.task_catalog[bundle.task_catalog["final_category"].astype(str).eq(category)]
    rows = rows.sort_values(["probability_rank", "fix_title"], kind="stable").head(limit)
    return [{
        "fixTitle": str(row.fix_title),
        "difficultyLevel": str(row.difficulty_level),
        "probabilityRank": int(row.probability_rank),
        "partsCostMinUsd": None if pd.isna(row.est_parts_cost_min_usd) else float(row.est_parts_cost_min_usd),
        "partsCostMaxUsd": None if pd.isna(row.est_parts_cost_max_usd) else float(row.est_parts_cost_max_usd),
    } for row in rows.itertuples()]


def get_task_by_title(bundle: ModelBundle, fix_title: str) -> Any | None:
    if bundle.task_catalog is None:
        return None
    rows = bundle.task_catalog[bundle.task_catalog["fix_title"].astype(str).eq(fix_title)]
    return None if rows.empty else rows.iloc[0]


def predict_duration(bundle: ModelBundle, task: Any) -> tuple[float, str]:
    has_costs = all(pd.notna(task[column]) for column in ("parts_cost_mid_usd", "parts_cost_range_usd"))
    if has_costs:
        if not bundle.duration.primary_available:
            raise RuntimeError("duration primary model artifact unavailable")
        frame = pd.DataFrame([{
            "fix_title": str(task.fix_title),
            "difficulty_level": str(task.difficulty_level),
            "probability_rank": int(task.probability_rank),
            "parts_cost_mid_usd": float(task.parts_cost_mid_usd),
            "parts_cost_range_usd": float(task.parts_cost_range_usd),
        }])
        return max(0.0, float(bundle.duration.primary.predict(frame)[0])), "task_plus_cost"
    if bundle.duration.fallback_available:
        frame = pd.DataFrame([{
            "fix_title": str(task.fix_title),
            "difficulty_level": str(task.difficulty_level),
            "probability_rank": int(task.probability_rank),
        }])
        return max(0.0, float(bundle.duration.fallback.predict(frame)[0])), "task_only_fallback"
    raise RuntimeError("duration model artifact unavailable")

