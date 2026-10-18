"""AutoSense Component 3 FastAPI inference service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status

from .config import settings
from .model_loader import ModelBundle, load_models
from .predictor import information_sources, predict_category, select_model_variant
from .schemas import CategoryPrediction, ForecastRequest, ForecastResponse, StatusResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
runtime: dict[str, ModelBundle] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    runtime["models"] = load_models()
    yield
    runtime.clear()


app = FastAPI(
    title="AutoSense Predictive Maintenance API",
    description="Inference API for Component 3 maintenance-category prediction using Basic and Enriched XGBoost models.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/", tags=["Health"])
def root() -> dict[str, str]:
    return {"service": "AutoSense Predictive Maintenance API", "docs": "/docs", "health": "/health"}


@app.get("/health", tags=["Health"])
def health() -> dict[str, object]:
    bundle = runtime.get("models")
    loaded = bundle.loaded if bundle else False
    return {"status": "ok" if loaded else "degraded", "service": settings.service_name, "modelsLoaded": loaded}


@app.get("/v1/model", tags=["Models"])
def model_info() -> dict[str, object]:
    bundle = runtime.get("models")
    classes: list[str] = []
    for variant in (bundle.basic, bundle.enriched) if bundle else ():
        if variant.available and hasattr(variant.encoder, "classes_"):
            classes = [str(value) for value in variant.encoder.classes_]
            break
    return {
        "service": settings.service_name,
        "task": "maintenance-category-classification",
        "primaryModel": "XGBoost",
        "variants": [
            {"name": "basic", "available": bool(bundle and bundle.basic.available)},
            {"name": "enriched", "available": bool(bundle and bundle.enriched.available)},
        ],
        "classes": classes,
        "durationModel": "not_available",
    }


@app.post("/v1/forecast", response_model=ForecastResponse, tags=["Forecasts"])
def forecast(request: ForecastRequest) -> ForecastResponse:
    bundle = runtime.get("models")
    variant = select_model_variant(request)
    if not bundle or not getattr(bundle, variant).available:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The selected prediction model is unavailable.")
    try:
        label, scores, score = predict_category(request, bundle)
    except Exception:
        logger.exception("Predictive maintenance inference failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Prediction could not be completed.")
    return ForecastResponse(
        assessmentType=variant,
        prediction=CategoryPrediction(category=label, modelScore=score, categoryScores=scores),
        maintenanceRequired=StatusResponse(status="not_evaluated", reason="The maintenance-required model is not integrated into this API."),
        engineCondition=StatusResponse(status="not_run", reason="Engine sensor measurements are not part of this forecast model."),
        duration=StatusResponse(status="model_pending"),
        informationSources=information_sources(request),
    )

