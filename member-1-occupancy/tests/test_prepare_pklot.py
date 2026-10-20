from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import pytest

from prepare_pklot import (HELD_OUT_CAMERA, MASK_FILL, apply_mask, assign_days, build_index, convert, outline_bbox,
                           parse_xml, sample_gold, space_mask, write_gold, yolo_line)

XML = """<?xml version="1.0"?>
<parking id="ufpr04">
  <space id="1" occupied="1">
    <rotatedRect><center x="100" y="100"/><size w="40" h="20"/><angle d="0"/></rotatedRect>
    <contour><point x="80" y="90"/><point x="120" y="90"/><point x="120" y="110"/><point x="80" y="110"/></contour>
  </space>
  <space id="2" occupied="0">
    <rotatedRect><center x="300" y="300"/><size w="40" h="20"/><angle d="0"/></rotatedRect>
    <contour><point x="280" y="290"/><point x="320" y="290"/><point x="320" y="310"/><point x="280" y="310"/></contour>
  </space>
  <space id="3">
    <rotatedRect><center x="500" y="500"/><size w="40" h="20"/><angle d="0"/></rotatedRect>
  </space>
</parking>"""


def _write(root: Path, camera: str, condition: str, date: str, stem: str, xml: str = XML) -> None:
    d = root / camera / condition / date
    d.mkdir(parents=True, exist_ok=True)
    (d / f'{stem}.xml').write_text(xml)
    cv2.imwrite(str(d / f'{stem}.jpg'), np.full((720, 1280, 3), 255, np.uint8))


def test_parse_xml_reads_states_and_falls_back_to_rotated_rect(tmp_path):
    p = tmp_path / 'a.xml'
    p.write_text(XML)
    s = parse_xml(p)
    assert [x.occupied for x in s] == [1, 0, None]
    assert s[2].contour[0] == pytest.approx((480, 490))      # rect corners when no contour


def test_outline_bbox_clips_and_yolo_line_normalises():
    assert outline_bbox([(-5, 10), (50, 10), (50, 800)], 1280, 720) == (0, 10, 50, 720)
    assert yolo_line((0, 0, 640, 360), 1280, 720) == '0 0.250000 0.250000 0.500000 0.500000'


def _manifest(rows):
    return pd.DataFrame(rows, columns=['image_id', 'camera', 'condition', 'date'])


def test_days_never_cross_splits_and_held_out_camera_is_xsite():
    rows = []
    for cam in ('PUCPR', 'UFPR04', HELD_OUT_CAMERA):
        for d in range(20):
            for cond in ('Sunny', 'Rainy') if d % 3 == 0 else ('Cloudy',):   # some days span two conditions
                rows += [(f'{cam}/{cond}/{d}/{i}', cam, cond, f'2012-01-{d:02d}') for i in range(5)]
    m = _manifest(rows)
    days = assign_days(m, seed=0)
    m['split'] = (m.camera + '/' + m.date).map(days)
    assert m.groupby(['camera', 'date']).split.nunique().max() == 1
    assert set(m[m.camera == HELD_OUT_CAMERA].split) == {'xsite'}
    trained = m[m.camera != HELD_OUT_CAMERA]
    share = trained.split.value_counts(normalize=True)
    assert set(share.index) == {'train', 'val', 'test'} and 0.6 < share['train'] < 0.8
    assert assign_days(m, seed=0) == days                      # deterministic


def test_index_and_convert_end_to_end(tmp_path):
    root, out = tmp_path / 'PKLot', tmp_path / 'out'
    _write(root, 'UFPR04', 'Sunny', '2012-12-07', '2012-12-07_17_12_25')
    _write(root, 'UFPR04', 'Sunny', '2012-12-08', '2012-12-08_09_00_00',
           XML.replace('<space id="3">', '<space id="3" occupied="0">'))
    manifest, spaces = build_index(root)
    assert list(manifest.n_unknown) == [1, 0] and manifest.hour.tolist() == [17, 9]
    days = {'UFPR04/2012-12-07': 'train', 'UFPR04/2012-12-08': 'train'}
    stats = convert(out, manifest, spaces, days)
    assert stats['train_images'] == 1 and stats['skipped_unknown_or_error'] == 1
    name = 'UFPR04__Sunny__2012-12-08__2012-12-08_09_00_00'
    label = (out / f'yolo/labels/train/{name}.txt').read_text().split()
    assert label[0] == '0' and float(label[1]) == pytest.approx(100 / 1280)   # only the occupied space
    assert 'names:\n  0: vehicle' in (out / 'pklot_vehicle.yaml').read_text()
    img = cv2.imread(str(out / f'yolo/images/train/{name}.jpg'))
    assert img[100, 100].min() > 240 and abs(int(img[700, 1200, 0]) - MASK_FILL) < 5   # space kept, rest greyed


def test_convert_never_writes_through_into_the_source_dataset(tmp_path):
    root, out = tmp_path / 'PKLot', tmp_path / 'out'
    stem = '2012-12-08_09_00_00'
    _write(root, 'UFPR04', 'Sunny', '2012-12-08', stem, XML.replace('<space id="3">', '<space id="3" occupied="0">'))
    src = root / f'UFPR04/Sunny/2012-12-08/{stem}.jpg'
    before = src.read_bytes()
    manifest, spaces = build_index(root)
    dst = out / f'yolo/images/train/UFPR04__Sunny__2012-12-08__{stem}.jpg'
    dst.parent.mkdir(parents=True)
    import os
    os.link(src, dst)                                          # leftover hard link from an earlier run
    convert(out, manifest, spaces, {'UFPR04/2012-12-08': 'train'})
    assert src.read_bytes() == before


def test_space_mask_keeps_spaces_plus_margin_only():
    mask = space_mask([[(10, 10), (20, 10), (20, 20), (10, 20)]], 40, 40, margin=2)
    assert mask[15, 15] == 255 and mask[15, 21] == 255 and mask[15, 30] == 0
    img = apply_mask(np.zeros((40, 40, 3), np.uint8), mask)
    assert img[15, 15].tolist() == [0, 0, 0] and img[35, 35].tolist() == [MASK_FILL] * 3


def test_gold_is_stratified_from_test_and_xsite_and_packaged_for_cvat(tmp_path):
    root, out = tmp_path / 'PKLot', tmp_path / 'out'
    full = XML.replace('<space id="3">', '<space id="3" occupied="0">')
    for cam, date in (('UFPR04', '2012-12-08'), ('UFPR04', '2012-12-09'), (HELD_OUT_CAMERA, '2013-02-22')):
        for i in range(3):
            _write(root, cam, 'Sunny', date, f'{date}_09_00_0{i}', full)
    manifest, spaces = build_index(root)
    days = {'UFPR04/2012-12-08': 'train', 'UFPR04/2012-12-09': 'test', f'{HELD_OUT_CAMERA}/2013-02-22': 'xsite'}
    gold = sample_gold(manifest, days, per_stratum=2)
    assert len(gold) == 4 and not gold.date.eq('2012-12-08').any()
    g = write_gold(out, gold, spaces)
    assert len(list((g / 'images').glob('*.jpg'))) == 4 and (g / 'cvat_preannotations.zip').exists()
    assert len((g / 'cvat_preannotations/train.txt').read_text().split()) == 4
