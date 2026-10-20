"""Load trusted model artifacts once and expose safe availability metadata."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from .config import Settings, settings

logger = logging.getLogger(__name__)


@dataclass
class VariantArtifacts:
    model: Any | None = None
    encoder: Any | None = None
    available: bool = False
    error: str | None = None


@dataclass
class DurationArtifacts:
    primary: Any | None = None
    fallback: Any | None = None
    metadata: dict[str, Any] | None = None
    primary_available: bool = False
    fallback_available: bool = False
    metadata_available: bool = False
    primary_error: str | None = None
    fallback_error: str | None = None
    metadata_error: str | None = None


REQUIRED_TASK_COLUMNS = {
    "fix_title", "final_category", "difficulty_level", "probability_rank",
    "est_parts_cost_min_usd", "est_parts_cost_max_usd", "parts_cost_mid_usd",
    "parts_cost_range_usd",
}


@dataclass
class ModelBundle:
    basic: VariantArtifacts
    enriched: VariantArtifacts
    duration: DurationArtifacts = field(default_factory=DurationArtifacts)
    task_catalog: pd.DataFrame | None = None
    task_catalog_error: str | None = None

    @property
    def loaded(self) -> bool:
        return self.basic.available or self.enriched.available

    @property
    def task_catalog_available(self) -> bool:
        return self.task_catalog is not None


def _load_variant(model_path: Path, encoder_path: Path) -> VariantArtifacts:
    try:
        if not model_path.is_file() or not encoder_path.is_file():
            missing = [str(path.name) for path in (model_path, encoder_path) if not path.is_file()]
            return VariantArtifacts(error=f"missing artifacts: {', '.join(missing)}")
        return VariantArtifacts(model=joblib.load(model_path), encoder=joblib.load(encoder_path), available=True)
    except Exception as exc:  # pickle/model errors must degrade health rather than crash startup
        logger.exception("Unable to load predictive maintenance artifacts")
        return VariantArtifacts(error=f"artifact load failed: {type(exc).__name__}")


def _paths_for_enriched(config: Settings) -> tuple[Path, Path]:
    preferred = config.model_dir / config.enriched_model_filename, config.model_dir / config.enriched_encoder_filename
    if preferred[0].is_file() and preferred[1].is_file():
        return preferred
    return config.model_dir / config.legacy_model_filename, config.model_dir / config.legacy_encoder_filename


def _artifact_path(config: Settings, explicit: Path | None, filename: str) -> Path:
    return explicit or config.model_dir / filename


def _load_duration(config: Settings) -> DurationArtifacts:
    result = DurationArtifacts()
    for name, path in (
        ("primary", _artifact_path(config, config.duration_model_path, config.duration_model_filename)),
        ("fallback", _artifact_path(config, config.duration_fallback_model_path, config.duration_fallback_model_filename)),
    ):
        try:
            if not path.is_file():
                setattr(result, f"{name}_error", f"missing artifact: {path}")
                continue
            setattr(result, name, joblib.load(path))
            setattr(result, f"{name}_available", True)
        except Exception as exc:
            logger.exception("Unable to load duration %s model", name)
            setattr(result, f"{name}_error", f"artifact load failed: {type(exc).__name__}")
    metadata_path = _artifact_path(config, config.duration_metadata_path, config.duration_metadata_filename)
    try:
        if not metadata_path.is_file():
            result.metadata_error = f"missing artifact: {metadata_path}"
        else:
            result.metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            result.metadata_available = True
    except Exception as exc:
        result.metadata_error = f"metadata load failed: {type(exc).__name__}"
    return result


def _load_task_catalog(config: Settings) -> tuple[pd.DataFrame | None, str | None]:
    path = _artifact_path(config, config.task_catalog_path, config.task_catalog_filename)
    try:
        if not path.is_file():
            return None, f"missing catalogue: {path}"
        catalog = pd.read_csv(path)
        missing = sorted(REQUIRED_TASK_COLUMNS - set(catalog.columns))
        if missing:
            return None, f"catalogue missing columns: {', '.join(missing)}"
        return catalog, None
    except Exception as exc:
        logger.exception("Unable to load maintenance task catalogue")
        return None, f"catalogue load failed: {type(exc).__name__}"


def load_models(config: Settings = settings) -> ModelBundle:
    basic = _load_variant(
        config.model_dir / config.basic_model_filename,
        config.model_dir / config.basic_encoder_filename,
    )
    enriched_paths = _paths_for_enriched(config)
    enriched = _load_variant(*enriched_paths)
    if not basic.available:
        logger.warning("Basic predictive maintenance model unavailable: %s", basic.error)
    if not enriched.available:
        logger.warning("Enriched predictive maintenance model unavailable: %s", enriched.error)
    duration = _load_duration(config)
    task_catalog, task_catalog_error = _load_task_catalog(config)
    return ModelBundle(basic=basic, enriched=enriched, duration=duration, task_catalog=task_catalog, task_catalog_error=task_catalog_error)

