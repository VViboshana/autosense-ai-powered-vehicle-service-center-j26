import json
import time

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import config, main, roi
from test_pipeline import BAY, BlobDetector, make_video


class FakeDetector(BlobDetector):
    """No YOLO in API tests: white blocks are vehicles."""
    def __init__(self, path, imgsz=1280):
        self.path = path

    def detect(self, image, confidence=0.25):
        return self.track(image)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'Detector', FakeDetector)
    monkeypatch.setattr(config, 'VIDEO_DIR', tmp_path.resolve())
    make_video(tmp_path / 'park.avi', 16, lambda t: 85 if 2 <= t < 9 else None)
    with TestClient(main.app) as c:
        yield c


def jpeg(with_car: bool) -> bytes:
    img = np.zeros((180, 320, 3), np.uint8)
    if with_car:
        img[50:130, 85:155] = 255
    return cv2.imencode('.jpg', img)[1].tobytes()


BAYS = json.dumps([{'id': 'B1', 'polygon': BAY.polygon}])


def test_health_reports_placeholder_model(client):
    r = client.get('/health').json()
    assert r['status'] == 'up' and r['model']['placeholder'] is (not config.MODEL_PATH.exists())


def test_analyze_scores_each_bay(client):
    r = client.post('/analyze', files={'image': ('f.jpg', jpeg(True), 'image/jpeg')}, data={'bays': BAYS})
    assert r.status_code == 200
    bay = r.json()['bays'][0]
    assert bay['id'] == 'B1' and bay['present'] and bay['score'] > 0.6
    r = client.post('/analyze', files={'image': ('f.jpg', jpeg(False), 'image/jpeg')}, data={'bays': BAYS})
    assert r.json()['bays'][0] == {'id': 'B1', 'score': 0.0, 'present': False, 'vehicle': None}


def test_health_reports_the_mask_default(client):
    model = client.get('/health').json()['model']
    assert model['roiMask'] == {'setting': config.ROI_MASK, 'default': roi.mask_default(model['placeholder']),
                                'marginPx': config.ROI_MARGIN_PX}


def test_analyze_masks_outside_the_bays_when_asked(client):
    img = np.zeros((180, 320, 3), np.uint8)
    img[50:130, 85:155] = 255     # in B1
    img[50:130, 250:320] = 255    # outside every bay
    files = {'image': ('f.png', cv2.imencode('.png', img)[1].tobytes(), 'image/png')}
    plain = client.post('/analyze', files=files, data={'bays': BAYS}, params={'mask': False}).json()
    masked = client.post('/analyze', files=files, data={'bays': BAYS}, params={'mask': True}).json()
    assert len(plain['vehicles']) == 2 and plain['roiMask'] == {'applied': False, 'marginPx': 0}
    assert len(masked['vehicles']) == 1 and masked['roiMask']['applied']
    assert masked['bays'][0]['present'] and masked['bays'][0]['score'] == plain['bays'][0]['score']


def test_video_job_reports_whether_it_was_masked(client, monkeypatch):
    body = {'jobId': 'J4', 'source': 'park.avi', 'bays': [{'id': 'B1', 'polygon': BAY.polygon}], 'mask': True}
    assert client.post('/video-jobs', json=body).json()['roiMask'] is True
    monkeypatch.setitem(main.state, 'mask', False)    # the service default is used when the request does not say
    body = {**body, 'jobId': 'J5'}
    del body['mask']
    assert client.post('/video-jobs', json=body).json()['roiMask'] is False


def test_analyze_rejects_bad_input(client):
    assert client.post('/analyze', files={'image': ('f.jpg', b'nope', 'image/jpeg')}, data={'bays': BAYS}).status_code == 400
    bad = json.dumps([{'id': 'B1', 'polygon': [[0, 0], [2, 0], [0, 1]]}])   # not normalised
    assert client.post('/analyze', files={'image': ('f.jpg', jpeg(True), 'image/jpeg')}, data={'bays': bad}).status_code == 422


def test_video_job_runs_and_reports_transitions(client):
    body = {'jobId': 'J1', 'source': 'park.avi', 'bays': [{'id': 'B1', 'polygon': BAY.polygon}],
            'rules': {'confirmOccupiedSeconds': 3, 'confirmFreeSeconds': 5}}
    assert client.post('/video-jobs', json=body).status_code == 202
    for _ in range(100):
        job = client.get('/video-jobs/J1').json()
        if job['status'] in ('completed', 'failed'):
            break
        time.sleep(0.05)
    assert job['status'] == 'completed', job['error']
    assert [(t['fromState'], t['toState'], t['atSeconds']) for t in job['transitions']] == [
        ('uncertain', 'occupied', 5.0), ('occupied', 'free', 14.0)]
    assert len(client.get('/video-jobs/J1?since=1').json()['transitions']) == 1
    assert client.post('/video-jobs', json=body).status_code == 202      # a finished job id may be reused


def test_video_job_only_reads_inside_the_video_folder(client):
    body = {'jobId': 'J2', 'source': '../../secret.mp4', 'bays': [{'id': 'B1', 'polygon': BAY.polygon}]}
    assert client.post('/video-jobs', json=body).status_code == 404
    assert client.get('/video-jobs/nope').status_code == 404


def test_invalid_rules_are_rejected(client):
    body = {'jobId': 'J3', 'source': 'park.avi', 'bays': [{'id': 'B1', 'polygon': BAY.polygon}],
            'rules': {'overlapThreshold': 0.2, 'releaseThreshold': 0.5}}
    assert client.post('/video-jobs', json=body).status_code == 422


def test_snapshot_returns_a_jpeg_frame(client):
    r = client.get('/snapshot', params={'source': 'park.avi', 'at': 3})
    assert r.status_code == 200 and r.headers['content-type'] == 'image/jpeg' and r.headers['x-frame-width'] == '320'
