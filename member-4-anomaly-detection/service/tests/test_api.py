"""API tests (FastAPI test client, no server). The /analyze test runs the real model on a 2 s synthetic clip."""
import time

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    from c4security import api
    monkeypatch.setattr(api, "DATA", tmp_path)
    return TestClient(api.app)


def test_health(client):
    r = client.get("/health").json()
    assert r["status"] == "ok" and r["model_found"]


def test_bay_state(client):
    ev = {"camera_id": "cam_01", "zone": "work_bay_1", "status": "occupied", "job_id": "JOB-7", "plate": "WP-1"}
    assert client.post("/bay-state", json=ev).json()["bays"]["work_bay_1"]["job_id"] == "JOB-7"
    ev["status"] = "free"
    assert client.post("/bay-state", json=ev).json()["bays"] == {}


def test_analyze_upload(client, tmp_path):
    clip = tmp_path / "blank.mp4"
    vw = cv2.VideoWriter(str(clip), cv2.VideoWriter_fourcc(*"mp4v"), 10, (320, 240))
    for _ in range(20):
        vw.write(np.full((240, 320, 3), 90, np.uint8))
    vw.release()
    jid = client.post("/analyze", files={"video": ("blank.mp4", open(clip, "rb"), "video/mp4")},
                      data={"camera_id": "cam_01"}).json()["job_id"]
    for _ in range(120):
        job = client.get(f"/jobs/{jid}").json()
        if job["status"] != "running":
            break
        time.sleep(0.5)
    assert job["status"] == "done", job["error"]
    assert client.get(f"/jobs/{jid}/files/summary.md").status_code == 200
    assert client.get(f"/jobs/{jid}/files/../../etc/passwd").status_code == 404
