# Walk-around inspection (live camera or video)

Instead of five separate photos, the technician walks round the vehicle with the phone camera. The app captures each
side by itself and marks damage live; the rest of the inspection (analysis, review, repair guide, hand-over) is
unchanged.

## Three ways to capture (New inspection › 2. Photos)

| Way | What happens |
|---|---|
| **Walk-around (live)** | Full-screen camera. About 2–3 frames a second go to the damage service; its answer is drawn over the picture (corner brackets on the vehicle, damage outlines with names and confidence). A side is captured **by itself** when the vehicle covers at least 20% of the frame, is not cut off, is sharp (Laplacian variance ≥ 100) and bright enough, for 0.9 s. Clear damage (≥ 50%) is kept as close-ups, the 3 strongest. Buttons: Close-up, Capture now, Finish. |
| **Upload video** | A 30–60 s walk-around filmed with the phone's camera app. About 1.5 frames a second (8–60 frames) go to the same endpoint; the video is split into four equal parts in the walking order and the best frame of each part (largest, sharpest whole vehicle) becomes that side; close-ups as above, 2 s apart. |
| **Photo slots** | As before: one photo per side. The walk-around and the video fill these slots, so any photo can still be retaken. |

**Damage is shown only on a vehicle.** The damage model only knows cars, so pointed at a person or a wall it still finds
"damage". Every frame also goes through the COCO vehicle finder: with no vehicle in view (and none in the last 3 s,
so walking up to a dent for a close-up still works) the damage boxes are hidden and the screen says "No vehicle in
view" or "That's a person, not a vehicle". Side photos with no vehicle get a warning on the inspection page.
Measured (`evaluation/vehicle_check.py` -> `evaluation/results/vehicle_check.md`): vehicle found in 16 of 16 whole-car
CarDD photos and 148 of 358 close-ups (41%); on 108 COCO128 images with no vehicle, none was taken for a vehicle and
damage boxes dropped from 44 (41%) to 0. A photo or screen showing a car is seen as a car (a camera cannot tell).

**One photo per side, from that side.** A side is only captured when the vehicle's shape matches it: from the front
or rear a car's box is narrow (width : height at most 1.6), from the side long (at least 1.9); in between is a corner
("Keep walking to the left side"). Measured on whole-car CarDD photos: front median 1.22, rear 1.09, side 2.12. So the
front cannot be captured again as the left side while the technician still stands in front, and every capture is
followed by a 1.5 s pause. "Capture now" overrides both.

**Sides come from the order of the walk** (front, left, rear, right), not from the picture: a single photo cannot
reliably tell the left side from the right (a mirrored car looks the same). The compass on screen shows which side is
next; tapping a side retakes it.

## Server

`POST /api/inspections/live-frame` (multipart `frame`, JPEG up to 3 MB, screen INSPECTION_CREATE): runs the damage
service's `/predict` on the frame and answers the vehicle box and its share of the frame, the quality figures and the
damage on the vehicle. **Nothing is stored.** One frame per user at a time: a frame sent while the previous one is
still being analysed is answered `busy` at once, so a slow laptop is never flooded and the picture never lags behind.
Code: `shared/backend/src/modules/inspections/inspections.live.ts`; phone side: `shared/frontend/src/modules/inspections/WalkAround.tsx`
and `walkFrames.ts`.

## Measured speed (development laptop, Intel i7-8650U, CPU only, 2026-10-26)

Damage service `/predict` on 40 CarDD test photos scaled to 640 px JPEG (17 KB each, as the phone sends them):
**median 250 ms, 90th percentile 287 ms**, so up to about 4 frames a second at the service. With the phone's upload
over Wi-Fi, expect about 2–3 frames a second on the camera view.

## Demo checklist

1. **Network:** the laptop joins the **phone's hotspot** (campus Wi-Fi often blocks phone-to-laptop traffic).
2. Double-click **`Start AutoSense (phone).cmd`** (in `C:\Manodya\Research`). It starts everything with the web app on
   https and prints the address to open on the phone, e.g. `https://192.168.43.20:5173/`. The first time, Windows asks
   whether Node.js may use the network: allow it on **private** networks.
3. On the phone open that address. It warns about the certificate (made on the laptop): **Advanced › Proceed**. Allow
   the camera when asked.
4. Sign in as a technician › New inspection › choose the job › **Walk-around** › Start. Stand 2–3 m in front of the car.
5. Walk front › left › rear › right at a slow pace; wait for the flash on each side. Take a close-up of a damaged area.
   Finish › Sound (optional) › Analyse.
6. Show the result on the laptop (same inspection, refreshed) for the panel.

**Fallback:** keep a walk-around video on the phone (recorded beforehand, MP4) and use **Upload video**.
**Light:** daylight or a lit bay; the capture waits in the dark ("Too dark: find more light").

## Limits

- Live speed depends on the laptop and the Wi-Fi; on a slow link the boxes trail the camera by a fraction of a second.
- The capture rules (20% share, sharpness 100, 0.9 s) are set by hand, not tuned on data.
- The video mode assumes an even walking pace (four equal parts); a side with no usable frame is reported, to be added as
  a photo.
- The phone does not store anything until Analyse; leaving the walk-around discards its frames.
