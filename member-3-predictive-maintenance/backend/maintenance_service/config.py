"""Environment-backed configuration for the predictive maintenance API."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


COMPONENT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_DIR = COMPONENT_DIR / "model"


@dataclass(frozen=True)
class Settings:
    service_name: str = os.getenv("AUTOSENSE_SERVICE_NAME", "maintenance-prediction")
    model_dir: Path = Path(os.getenv("AUTOSENSE_MODEL_DIR", str(DEFAULT_MODEL_DIR))).expanduser()
    host: str = os.getenv("AUTOSENSE_HOST", "127.0.0.1")
    port: int = int(os.getenv("AUTOSENSE_PORT", "8003"))

    basic_model_filename: str = os.getenv(
        "AUTOSENSE_BASIC_MODEL_FILENAME", "maintenance_category_basic_xgboost.pkl"
    )
    basic_encoder_filename: str = os.getenv(
        "AUTOSENSE_BASIC_ENCODER_FILENAME", "maintenance_category_basic_encoder.pkl"
    )
    enriched_model_filename: str = os.getenv(
        "AUTOSENSE_ENRICHED_MODEL_FILENAME", "maintenance_category_enriched_xgboost.pkl"
    )
    enriched_encoder_filename: str = os.getenv(
        "AUTOSENSE_ENRICHED_ENCODER_FILENAME", "maintenance_category_enriched_encoder.pkl"
    )

    # Artifacts produced by the currently checked-in research notebook (03).
    legacy_model_filename: str = "maintenance_category_xgboost.pkl"
    legacy_encoder_filename: str = "maintenance_category_label_encoder.pkl"


settings = Settings()

