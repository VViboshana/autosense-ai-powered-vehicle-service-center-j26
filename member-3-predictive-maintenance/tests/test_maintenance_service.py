from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import backend.maintenance_service.main as service_main
from backend.maintenance_service.main import app, runtime
from backend.maintenance_service.model_loader import ModelBundle, VariantArtifacts
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
        assert client.get("/health").json() == {"status": "ok", "service": "maintenance-prediction", "modelsLoaded": True}
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
    assert body["duration"]["status"] == "model_pending"
    assert all(body["informationSources"].values())


def test_unavailable_selected_model_returns_503(monkeypatch):
    unavailable = ModelBundle(
        basic=VariantArtifacts(error="missing"), enriched=VariantArtifacts(error="missing")
    )
    monkeypatch.setattr(service_main, "load_models", lambda: unavailable)
    with TestClient(app) as client:
        response = client.post("/v1/forecast", json=payload())
    assert response.status_code == 503
