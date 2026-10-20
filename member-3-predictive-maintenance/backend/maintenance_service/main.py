"""AutoSense Component 3 FastAPI inference service."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status

from .config import settings
from .model_loader import ModelBundle, load_models
from .predictor import SUPPORTED_CATEGORIES, get_candidate_tasks, get_task_by_title, information_sources, predict_category, predict_duration, select_model_variant
from .schemas import CategoryPrediction, DurationEstimate, DurationPredictionRequest, DurationPredictionResponse, DurationTaskInfo, ForecastRequest, ForecastResponse, StatusResponse, TaskCandidate, TaskSelection

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
    duration = bundle.duration if bundle else None
    catalog_ready = bool(bundle and bundle.task_catalog_available)
    return {
        "status": "ok" if loaded and duration and duration.primary_available and catalog_ready else "degraded",
        "service": settings.service_name,
        "modelsLoaded": loaded,
        "categoryModel": "ready" if loaded else "unavailable",
        "durationPrimaryModel": "ready" if duration and duration.primary_available else "unavailable",
        "durationFallbackModel": "ready" if duration and duration.fallback_available else "unavailable",
        "taskCatalogue": "ready" if catalog_ready else "unavailable",
    }


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
        "durationModel": _duration_model_info(bundle),
        "taskCatalogue": {"status": "ready" if bundle and bundle.task_catalog_available else "unavailable", "supportedCategories": list(SUPPORTED_CATEGORIES)},
    }


def _duration_model_info(bundle: ModelBundle | None) -> dict[str, object]:
    duration = bundle.duration if bundle else None
    metadata = duration.metadata if duration else None
    primary = (metadata or {}).get("primary_model", {})
    fallback = (metadata or {}).get("fallback_model", {})
    return {
        "status": "ready" if duration and (duration.primary_available or duration.fallback_available) else "unavailable",
        "algorithm": "RandomForestRegressor",
        "primaryVariant": "task_plus_cost",
        "fallbackVariant": "task_only_fallback",
        "targetType": (metadata or {}).get("targetType", (metadata or {}).get("target", "estimated_labor_hours")),
        "benchmark": True,
        "primaryCvMetrics": (metadata or {}).get("primaryCvMetrics", {
            "maeMinutes": primary.get("cv_mean_mae_minutes"),
            "rmseMinutes": primary.get("cv_mean_rmse_minutes"),
            "r2": primary.get("cv_mean_r2"),
        }),
        "fallbackCvMetrics": (metadata or {}).get("fallbackCvMetrics", {
            "maeMinutes": fallback.get("cv_mean_mae_minutes"),
            "rmseMinutes": fallback.get("cv_mean_rmse_minutes"),
            "r2": fallback.get("cv_mean_r2"),
        }),
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
    candidates = get_candidate_tasks(bundle, label)
    catalog_available = bundle.task_catalog_available
    return ForecastResponse(
        assessmentType=variant,
        prediction=CategoryPrediction(category=label, modelScore=score, categoryScores=scores),
        maintenanceRequired=StatusResponse(status="not_evaluated", reason="The maintenance-required model is not integrated into this API."),
        engineCondition=StatusResponse(status="not_run", reason="Engine sensor measurements are not part of this forecast model."),
        duration=StatusResponse(status="awaiting_task_selection" if catalog_available else "task_catalog_unavailable"),
        informationSources=information_sources(request),
        taskSelection=TaskSelection(status="available" if catalog_available else "unavailable", required=True, candidateTasks=[TaskCandidate(**candidate) for candidate in candidates]),
    )


@app.get("/v1/tasks/{category}", tags=["Tasks"])
def tasks(category: str, limit: int = 8) -> dict[str, object]:
    if category not in SUPPORTED_CATEGORIES:
        raise HTTPException(status_code=422, detail="Unsupported maintenance category.")
    if limit < 1 or limit > 20:
        raise HTTPException(status_code=422, detail="limit must be between 1 and 20.")
    bundle = runtime.get("models")
    if not bundle or not bundle.task_catalog_available:
        raise HTTPException(status_code=503, detail="Task catalogue unavailable.")
    candidates = get_candidate_tasks(bundle, category, limit)
    return {"category": category, "count": len(candidates), "taskSelectionRequired": True, "candidateTasks": candidates}


@app.post("/v1/duration", response_model=DurationPredictionResponse, tags=["Forecasts"])
def duration(request: DurationPredictionRequest) -> DurationPredictionResponse:
    bundle = runtime.get("models")
    if not bundle or not bundle.task_catalog_available:
        raise HTTPException(status_code=503, detail="Task catalogue unavailable.")
    task = get_task_by_title(bundle, request.fix_title)
    if task is None:
        raise HTTPException(status_code=404, detail="Specific repair task not found.")
    try:
        hours, variant = predict_duration(bundle, task)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("Duration inference failed")
        raise HTTPException(status_code=500, detail="Duration prediction could not be completed.")
    return DurationPredictionResponse(
        status="evaluated",
        task=DurationTaskInfo(fixTitle=str(task.fix_title), category=str(task.final_category), difficultyLevel=str(task.difficulty_level), probabilityRank=int(task.probability_rank)),
        duration=DurationEstimate(estimatedHours=round(hours, 2), estimatedMinutes=round(hours * 60)),
        model={"algorithm": "RandomForestRegressor", "variant": variant},
        benchmark=True,
        targetType="estimated_labor_hours",
    )

