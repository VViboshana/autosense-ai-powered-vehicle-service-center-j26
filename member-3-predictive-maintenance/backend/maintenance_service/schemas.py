"""Request and response schemas for the public API."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class APIModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class Vehicle(APIModel):
    registration: Optional[str] = None
    make: str
    model: str
    year: int = Field(ge=1886, le=2100)
    mileage: Optional[float] = Field(default=None, ge=0)

    @field_validator("make", "model")
    @classmethod
    def non_empty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class CustomerReport(APIModel):
    problem_description: str = Field(alias="problemDescription")
    severity: str
    first_noticed: Optional[str] = Field(default=None, alias="firstNoticed")
    warning_light_visible: Optional[bool] = Field(default=None, alias="warningLightVisible")
    notes: Optional[str] = None

    @field_validator("problem_description", "severity")
    @classmethod
    def required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class ServiceHistory(APIModel):
    available: bool = False
    summary: Optional[str] = None


class Diagnostics(APIModel):
    ecu_data: Any = Field(default=None, alias="ecuData")
    diagnosis: Optional[str] = None


class Inspection(APIModel):
    linked: bool = False
    inspection_id: Optional[str] = Field(default=None, alias="inspectionId")


class ForecastRequest(APIModel):
    vehicle: Vehicle
    customer_report: CustomerReport = Field(alias="customerReport")
    service_history: Optional[ServiceHistory] = Field(default=None, alias="serviceHistory")
    diagnostics: Optional[Diagnostics] = None
    inspection: Optional[Inspection] = None


class StatusResponse(APIModel):
    status: str
    label: Optional[str] = None
    reason: Optional[str] = None
    minutes: Optional[int] = None


class CategoryPrediction(APIModel):
    category: str
    model_score: float = Field(alias="modelScore")
    category_scores: dict[str, float] = Field(alias="categoryScores")


class ForecastResponse(APIModel):
    assessment_type: str = Field(alias="assessmentType")
    prediction: CategoryPrediction
    maintenance_required: StatusResponse = Field(alias="maintenanceRequired")
    engine_condition: StatusResponse = Field(alias="engineCondition")
    duration: StatusResponse
    information_sources: dict[str, bool] = Field(alias="informationSources")

