"""Turns an engine alert (engine.py) into the AutoSense `security.alert` JSON.

The engine is unchanged; this only renames and groups its fields, using configs/integration.yaml:
  alert_id, threat, severity, affected, notify, reason, confidence, camera_id, snapshot, timestamp, status
Extra engine details (zone, track ids, plates, job ids) are kept under "details" so nothing is lost.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path

import yaml

PKG = Path(__file__).resolve().parents[1]
DEFAULT_INTEGRATION = PKG / "configs" / "integration.yaml"


def load_integration(path=DEFAULT_INTEGRATION) -> dict:
    with open(path) as fh:
        return yaml.safe_load(fh)


def affected_of(alert: dict, cfg: dict) -> str:
    """vehicle | people | both | premises (rules in integration.yaml, alert.premises_threats)."""
    vehicles = bool(alert.get("affected_vehicles"))
    people = (alert.get("affected_persons") or 0) > 0
    if vehicles and people:
        return "both"
    if vehicles:
        return "vehicle"
    if people:
        return "people"
    if alert.get("threat_type") in cfg["alert"]["premises_threats"]:
        return "premises"
    return cfg["alert"]["fallback_affected"]


def notify_of(alert: dict, cfg: dict) -> dict:
    """Engine notify_roles grouped as {staff, manager, customer, emergency}; unknown roles go under 'other'."""
    groups = cfg["alert"]["notify_groups"]
    ignore = set(cfg["alert"].get("ignore_roles", []))
    out = {g: [] for g in groups}
    for role in alert.get("notify_roles", []):
        if role in ignore:
            continue
        group = next((g for g, roles in groups.items() if role in roles), "other")
        out.setdefault(group, []).append(role)
    return out


def to_security_alert(alert: dict, cfg: dict | None = None) -> dict:
    cfg = cfg or load_integration()
    a = cfg["alert"]
    severity = alert["severity"].lower() if a.get("severity_lower_case", True) else alert["severity"]
    return {
        "event": "security.alert",
        "alert_id": alert["alert_id"],
        "threat": a["threat_names"].get(alert["threat_type"], alert["threat_type"]),
        "severity": severity,
        "affected": affected_of(alert, cfg),
        "notify": notify_of(alert, cfg),
        "reason": alert.get("reasons") or [],
        "confidence": alert.get("confidence"),
        "camera_id": alert.get("camera_id"),
        "snapshot": alert.get("snapshot"),
        # The camera clock when known (--start-time / live), otherwise when the frame was processed
        "timestamp": alert.get("clock_time") or alert.get("processed_at") or datetime.now().isoformat(timespec="seconds"),
        "status": alert.get("status", "open"),
        "details": {
            "zone": alert.get("zone"),
            "escalated_from": alert.get("escalated_from"),
            "person_track_id": alert.get("person_track_id"),
            "person_role": alert.get("person_role"),
            "affected_vehicles": alert.get("affected_vehicles", []),
            "affected_persons": alert.get("affected_persons", 0),
            "video_time_s": alert.get("video_time_s"),
            "source": alert.get("source"),
        },
    }
