"""Load trusted model artifacts once and expose safe availability metadata."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib

from .config import Settings, settings

logger = logging.getLogger(__name__)


@dataclass
class VariantArtifacts:
    model: Any | None = None
    encoder: Any | None = None
    available: bool = False
    error: str | None = None


@dataclass
class ModelBundle:
    basic: VariantArtifacts
    enriched: VariantArtifacts

    @property
    def loaded(self) -> bool:
        return self.basic.available or self.enriched.available


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
    return ModelBundle(basic=basic, enriched=enriched)

