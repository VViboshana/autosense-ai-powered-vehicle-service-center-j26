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
    estimated_hours: Optional[float] = Field(default=None, alias="estimatedHours")
    estimated_minutes: Optional[int] = Field(default=None, alias="estimatedMinutes")


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
    task_selection: "TaskSelection" = Field(alias="taskSelection")


class TaskCandidate(APIModel):
    fix_title: str = Field(alias="fixTitle")
    difficulty_level: str = Field(alias="difficultyLevel")
    probability_rank: int = Field(alias="probabilityRank")
    parts_cost_min_usd: Optional[float] = Field(default=None, alias="partsCostMinUsd")
    parts_cost_max_usd: Optional[float] = Field(default=None, alias="partsCostMaxUsd")


class TaskSelection(APIModel):
    status: str
    required: bool = True
    candidate_tasks: list[TaskCandidate] = Field(default_factory=list, alias="candidateTasks")


class DurationPredictionRequest(APIModel):
    fix_title: str = Field(alias="fixTitle", min_length=1)


class DurationTaskInfo(APIModel):
    fix_title: str = Field(alias="fixTitle")
    category: str
    difficulty_level: str = Field(alias="difficultyLevel")
    probability_rank: int = Field(alias="probabilityRank")


class DurationEstimate(APIModel):
    estimated_hours: float = Field(alias="estimatedHours")
    estimated_minutes: int = Field(alias="estimatedMinutes")


class DurationPredictionResponse(APIModel):
    status: str
    task: DurationTaskInfo
    duration: DurationEstimate
    model: dict[str, str]
    benchmark: bool
    target_type: str = Field(alias="targetType")

