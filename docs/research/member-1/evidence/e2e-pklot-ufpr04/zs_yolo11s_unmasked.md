# End-to-end check: zs_yolo11s_unmasked

weights `yolo11s.pt`, mask `False`, marginPx `0`, frame `1280x720`, sampleFps `2.0`, framesAnalysed `720`, seconds `515.0`, msPerFrame `715`

**359 / 360** bay states match the PKLot labels.

| expected -> got | count |
|---|---|
| free->free | 154 |
| free->occupied | 1 |
| occupied->occupied | 205 |

| bay | image | time | expected | got |
|---|---|---|---|---|
| 13 | 58 | 16:35:12 | free | occupied |
