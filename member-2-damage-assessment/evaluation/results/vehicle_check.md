# Vehicle check: does the finder see the vehicle, and only the vehicle?

Vehicle finder: `yolo11n-seg.pt` (COCO, car / motorcycle / bus / truck, confidence >= 0.4), `predictor.look`. Damage model: `best.pt`, findings from 0.25.

## 1. Photos that show a car (CarDD test set, 374 photos)

| CarDD photo | Vehicle found |
|---|---|
| Whole car ("complete") | 16 of 16 (100%) |
| Part of a car ("partial", close-ups) | 148 of 358 (41%) |

## 2. Images with no vehicle (COCO128: people, rooms, animals, food)

108 of the 128 images have no car, motorcycle, bus or truck in their labels.

| Measure | Result |
|---|---|
| Vehicle wrongly found | 0 of 108 (0%) |
| Person recognised (images with a person) | 33 of 51 (65%) |
| Damage boxes shown, before (no vehicle check) | 44 of 108 (41%) |
| Damage boxes shown, after (only with a vehicle) | 0 of 108 (0%) |

## Reading it

- A whole car, as in the walk-around (2-3 m away), is what the finder is reliable on. Close-ups (part of a panel)
  are often not recognised as a vehicle: the walk-around therefore keeps damage visible for 3 s after it last saw a
  vehicle, and the Close-up button always works.
- Limits: COCO128 images come from COCO's training images, which the COCO vehicle finder learned from, so part 2 is
  optimistic; it is a small sample. A photo or screen showing a car is (correctly, for a camera) seen as a car.
