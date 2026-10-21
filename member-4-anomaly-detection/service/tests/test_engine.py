"""Rule-engine tests with synthetic detections (no model, no GPU). Run: python -m pytest tests"""
from pathlib import Path

from c4security.engine import ThreatEngine, load_rules

RULES = Path(__file__).resolve().parents[1] / "configs" / "threat_rules.yaml"
ZONES = {"camera_id": "cam_t", "restricted": [{"name": "bay_1", "points": [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]}],
         "bays": {"bay_1": {"job_id": "JOB-9", "plate": "AB-1"}}}
CAR = {"cls": "vehicle", "conf": 0.9, "box": (600, 300, 900, 500), "id": 1}


def run(frames, overrides=(), fps=10):
    eng = ThreatEngine(load_rules(RULES, overrides), ZONES, 1000, 600)
    alerts = []
    for i, dets in enumerate(frames):
        alerts += eng.process(i / fps, [dict(d) for d in dets], i)[1]
    return eng, alerts


def person(x0, pid=7, conf=0.8):
    return {"cls": "person", "conf": conf, "box": (x0, 250, x0 + 80, 500), "id": pid}


def test_fire_needs_persistence_then_critical():
    fire = {"cls": "fire", "conf": 0.8, "box": (620, 320, 700, 400), "id": None}
    _, a = run([[CAR, fire]] * 15)          # 1.4 s < persistence 2 s
    assert a == []
    _, a = run([[CAR, fire]] * 30)
    assert [x["threat_type"] for x in a] == ["fire"] and a[0]["severity"] == "Critical"
    assert a[0]["affected_vehicles"][0]["job_id"] == "JOB-9"


def test_low_conf_weapon_ignored():
    _, a = run([[{"cls": "weapon", "conf": 0.40, "box": (10, 10, 50, 50), "id": None}]] * 40)
    assert a == []


def test_visitor_touching_car_is_tampering_worker_is_not():
    _, a = run([[CAR, person(620)]] * 40, ["tampering.touch_s=2"])
    assert any(x["threat_type"] == "tampering" and x["person_role"] == "visitor" for x in a)
    vest = {"cls": "worker", "conf": 0.9, "box": (620, 250, 700, 500), "id": None}
    _, a = run([[CAR, person(620), vest]] * 40, ["tampering.touch_s=2"])
    assert not any(x["threat_type"] in ("tampering", "loitering", "unauthorised_access") for x in a)


def test_cooldown_stops_repeats():
    fire = {"cls": "fire", "conf": 0.8, "box": (10, 10, 60, 60), "id": None}
    _, a = run([[fire]] * 200)               # 20 s, cooldown 30 s
    assert len(a) == 1


def test_bay_state_update():
    eng = ThreatEngine(load_rules(RULES), ZONES, 1000, 600)
    eng.update_bay("bay_1", {"job_id": "JOB-NEW"})
    assert eng.bays["bay_1"]["job_id"] == "JOB-NEW"
    eng.update_bay("bay_1", None)
    assert "bay_1" not in eng.bays
