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
    encoded_prediction = int(artifacts.model.predict(frame)[0])
    label = str(artifacts.encoder.inverse_transform([encoded_prediction])[0])
    probabilities = artifacts.model.predict_proba(frame)[0]
    classes = [str(value) for value in artifacts.encoder.classes_]
    model_classes = getattr(artifacts.model, "classes_", range(len(probabilities)))
    scores = {str(artifacts.encoder.inverse_transform([int(class_id)])[0]): float(probability) for class_id, probability in zip(model_classes, probabilities)}
    return label, scores, float(scores[label])

