from __future__ import annotations

import pytest
import pandas as pd
from fastapi.testclient import TestClient

import backend.maintenance_service.main as service_main
from backend.maintenance_service.main import app, runtime
from backend.maintenance_service.model_loader import DurationArtifacts, ModelBundle, VariantArtifacts
from backend.maintenance_service.predictor import information_sources, select_model_variant
from backend.maintenance_service.schemas import ForecastRequest


class FakeEncoder:
    classes_ = ["Battery", "Brakes", "Electrical", "Engine", "Transmission"]

    def inverse_transform(self, values):
        return [self.classes_[int(value)] for value in values]


class FakeModel:
    classes_ = [0, 1, 2, 3, 4]

    def predict(self, frame):
        return [1]

    def predict_proba(self, frame):
        return [[0.05, 0.7, 0.1, 0.1, 0.05]]


class FakeDurationModel:
    def predict(self, frame):
        return [0.5]


def payload(**overrides):
    result = {
        "vehicle": {"make": "Toyota", "model": "Corolla", "year": 2018},
        "customerReport": {"problemDescription": "Grinding noise while braking", "severity": "High"},
    }
    result.update(overrides)
    return result


@pytest.fixture(autouse=True)
def fake_models(monkeypatch):
    bundle = ModelBundle(
        basic=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        enriched=VariantArtifacts(FakeModel(), FakeEncoder(), True),
    )
    monkeypatch.setattr(service_main, "load_models", lambda: bundle)
    runtime["models"] = bundle
    yield
    runtime.clear()


def test_health_and_model_info():
    with TestClient(app) as client:
        health = client.get("/health").json()
        assert health["status"] == "degraded"
        assert health["categoryModel"] == "ready"
        assert health["taskCatalogue"] == "unavailable"
        info = client.get("/v1/model").json()
        assert info["primaryModel"] == "XGBoost"
        assert all(item["available"] for item in info["variants"])


def test_missing_required_fields_are_rejected():
    with TestClient(app) as client:
        response = client.post("/v1/forecast", json={"vehicle": {"make": "Toyota"}})
        assert response.status_code == 422


def test_basic_and_enriched_selection():
    basic = ForecastRequest.model_validate(payload())
    enriched = ForecastRequest.model_validate(payload(serviceHistory={"available": True, "summary": "Brake inspection completed"}))
    diagnosis = ForecastRequest.model_validate(payload(diagnostics={"diagnosis": "Worn brake pads"}))
    blank = ForecastRequest.model_validate(payload(serviceHistory={"available": True, "summary": " Unknown "}))
    assert select_model_variant(basic) == "basic"
    assert select_model_variant(enriched) == "enriched"
    assert select_model_variant(diagnosis) == "enriched"
    assert select_model_variant(blank) == "basic"


def test_forecast_shape_and_information_sources():
    request = payload(
        serviceHistory={"available": True, "summary": "Brake inspection completed"},
        diagnostics={"ecuData": "P0011", "diagnosis": "Worn brake pads"},
        inspection={"linked": True, "inspectionId": "INSP-1"},
    )
    with TestClient(app) as client:
        response = client.post("/v1/forecast", json=request)
    assert response.status_code == 200
    body = response.json()
    assert body["assessmentType"] == "enriched"
    assert body["prediction"]["category"] == "Brakes"
    assert set(body["prediction"]["categoryScores"]) == set(FakeEncoder.classes_)
    assert body["maintenanceRequired"]["status"] == "not_evaluated"
    assert body["engineCondition"]["status"] == "not_run"
    assert body["duration"]["status"] == "task_catalog_unavailable"
    assert body["taskSelection"]["status"] == "unavailable"
    assert all(body["informationSources"].values())


def test_unavailable_selected_model_returns_503(monkeypatch):
    unavailable = ModelBundle(
        basic=VariantArtifacts(error="missing"), enriched=VariantArtifacts(error="missing")
    )
    monkeypatch.setattr(service_main, "load_models", lambda: unavailable)
    with TestClient(app) as client:
        response = client.post("/v1/forecast", json=payload())
    assert response.status_code == 503


def test_task_catalogue_and_duration_endpoints(monkeypatch):
    catalog = pd.DataFrame([{
        "fix_title": "Replace brake pedal switch",
        "final_category": "Brakes",
        "difficulty_level": "Moderate DIY",
        "probability_rank": 1,
        "est_parts_cost_min_usd": 3.0,
        "est_parts_cost_max_usd": 15.0,
        "parts_cost_mid_usd": 9.0,
        "parts_cost_range_usd": 12.0,
    }])
    bundle = ModelBundle(
        basic=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        enriched=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        duration=DurationArtifacts(primary=FakeDurationModel(), primary_available=True),
        task_catalog=catalog,
    )
    monkeypatch.setattr(service_main, "load_models", lambda: bundle)
    with TestClient(app) as client:
        tasks_response = client.get("/v1/tasks/Brakes")
        duration_response = client.post("/v1/duration", json={"fixTitle": "Replace brake pedal switch"})
    assert tasks_response.status_code == 200
    assert tasks_response.json()["candidateTasks"][0]["fixTitle"] == "Replace brake pedal switch"
    assert duration_response.status_code == 200
    body = duration_response.json()
    assert body["status"] == "evaluated"
    assert body["model"]["variant"] == "task_plus_cost"
    assert body["benchmark"] is True


def test_forecast_waits_for_task_selection_when_catalogue_is_available(monkeypatch):
    catalog = pd.DataFrame([{
        "fix_title": "Replace brake pedal switch",
        "final_category": "Brakes",
        "difficulty_level": "Moderate DIY",
        "probability_rank": 1,
        "est_parts_cost_min_usd": 3.0,
        "est_parts_cost_max_usd": 15.0,
        "parts_cost_mid_usd": 9.0,
        "parts_cost_range_usd": 12.0,
    }])
    bundle = ModelBundle(
        basic=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        enriched=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        task_catalog=catalog,
    )
    monkeypatch.setattr(service_main, "load_models", lambda: bundle)
    with TestClient(app) as client:
        response = client.post("/v1/forecast", json=payload())
    assert response.status_code == 200
    body = response.json()
    assert body["taskSelection"]["required"] is True
    assert body["taskSelection"]["status"] == "available"
    assert body["duration"]["status"] == "awaiting_task_selection"
    assert body["duration"]["estimatedMinutes"] is None


def test_fallback_and_unknown_task_are_explicit(monkeypatch):
    catalog = pd.DataFrame([{
        "fix_title": "Inspect brake connector",
        "final_category": "Brakes",
        "difficulty_level": "Easy DIY",
        "probability_rank": 2,
        "est_parts_cost_min_usd": None,
        "est_parts_cost_max_usd": None,
        "parts_cost_mid_usd": None,
        "parts_cost_range_usd": None,
    }])
    bundle = ModelBundle(
        basic=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        enriched=VariantArtifacts(FakeModel(), FakeEncoder(), True),
        duration=DurationArtifacts(fallback=FakeDurationModel(), fallback_available=True),
        task_catalog=catalog,
    )
    monkeypatch.setattr(service_main, "load_models", lambda: bundle)
    with TestClient(app) as client:
        fallback = client.post("/v1/duration", json={"fixTitle": "Inspect brake connector"})
        unknown = client.post("/v1/duration", json={"fixTitle": "Made Up Repair Task XYZ"})
    assert fallback.status_code == 200
    assert fallback.json()["model"]["variant"] == "task_only_fallback"
    assert unknown.status_code == 404
