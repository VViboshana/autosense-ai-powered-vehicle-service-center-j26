"""Setup checks: the trained model loads with the training class order, a threat rule fires, and the AutoSense
security.alert JSON has every required field. Run: python -m pytest tests"""
from pathlib import Path

import pytest

from c4security.alert_format import affected_of, load_integration, notify_of, to_security_alert
from c4security.engine import ThreatEngine, load_rules

ROOT = Path(__file__).resolve().parents[1]
RULES = ROOT / "configs" / "threat_rules.yaml"
CFG = load_integration()
ZONES = {"camera_id": "cam_t", "restricted": [{"name": "bay_1", "points": [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]}],
         "bays": {"bay_1": {"job_id": "JOB-9", "plate": "AB-1"}}}
CAR = {"cls": "vehicle", "conf": 0.9, "box": (600, 300, 900, 500), "id": 1}
FIRE = {"cls": "fire", "conf": 0.8, "box": (620, 320, 700, 400), "id": None}


def fire_alert():
    eng = ThreatEngine(load_rules(RULES), ZONES, 1000, 600)
    alerts = []
    for i in range(30):  # 3 s at 10 fps: longer than the 2 s persistence
        alerts += eng.process(i / 10, [dict(CAR), dict(FIRE)], i)[1]
    return alerts


@pytest.fixture(scope="module")
def model():
    from c4security.infer import load
    return load(CFG)


def test_model_loads(model):
    assert model is not None and len(model.names) > 0


def test_classes_match_training_order(model):
    from c4security.infer import check_classes
    ok, actual, expected = check_classes(model, CFG)
    assert ok, f"model classes {actual} != training order {expected}"
    assert actual[:5] == ["person", "vehicle", "weapon", "fire", "smoke"]


def test_model_runs_on_one_frame(model):
    from c4security.infer import blank_frame, run_once
    dets = run_once(model, blank_frame())
    assert isinstance(dets, list)


def test_fire_rule_fires_critical():
    alerts = fire_alert()
    assert [a["threat_type"] for a in alerts] == ["fire"]
    assert alerts[0]["severity"] == "Critical"


def test_security_alert_has_required_fields():
    out = to_security_alert(fire_alert()[0], CFG)
    for field in CFG["alert"]["required_fields"]:
        assert field in out, f"missing {field}"
    assert out["threat"] == "fire" and out["severity"] == "critical"
    assert out["affected"] == "vehicle"                      # fire next to a parked car, nobody nearby
    assert "centre_manager" in out["notify"]["manager"]
    assert "vehicle_owner" in out["notify"]["customer"]
    assert "fire_service" in out["notify"]["emergency"]


def test_affected_and_notify_mapping():
    base = {"threat_type": "smoke", "affected_vehicles": [], "affected_persons": 0}
    assert affected_of(base, CFG) == "premises"
    assert affected_of({**base, "affected_persons": 2}, CFG) == "people"
    assert affected_of({**base, "affected_vehicles": [{"zone": "bay_1"}], "affected_persons": 1}, CFG) == "both"
    assert to_security_alert({**base, "alert_id": "x", "severity": "High", "threat_type": "tampering"}, CFG)["threat"] == "vehicle_tampering"
    n = notify_of({"notify_roles": ["log_only", "security_guard", "police"]}, CFG)
    assert n["staff"] == ["security_guard"] and n["emergency"] == ["police"] and n["manager"] == []
