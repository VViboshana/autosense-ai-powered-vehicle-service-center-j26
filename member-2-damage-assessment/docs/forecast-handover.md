# Inspection → maintenance forecast hand-over (`inspection-handover-v1`)

For: the maintenance forecast (component 3). From: damage assessment (component 2).

When a technician confirms a damage inspection, component 2 hands over **everything the forecast can use, in the
forecast's own terms**: whether the vehicle is safe to drive, a ready-written diagnosis, the forecast categories the
sounds point to, the workshop hours and the parts likely needed. Only technician-checked results are used (rejected
regions and sounds are left out).

## Where to get it

| Way | When | Access |
|---|---|---|
| `GET /api/inspections/:id/handover` | any time; `final: false` until the inspection is confirmed | screens `MAINTENANCE_FORECASTS`, `INSPECTION_HISTORY` or `INSPECTION_REVIEW` |
| `app.events`, `event_type = 'inspection.report'`, field `payload.handover` | written once, when the inspection is confirmed | database |
| Inspection page, card "Hand-over to maintenance" | for people; has a **Copy** button for the diagnosis | staff |

`:id` is the numeric `inspectionId`: the forecast already has it (`maintenance.forecasts.inspection_id`, and the
vehicle bootstrap's `inspections[].inspectionId`).

## How the forecast can use it

1. **Diagnosis → the forecast request.** Put `handover.diagnosis` into `diagnostics.diagnosis` of `POST /api/maintenance/forecasts`
   (or prefill Step 3 "Technician diagnosis" with it). This also makes the **enriched** model run, which today needs a
   diagnosis or service history.
2. **Category hints → a cross-check.** `categoryHints` uses the forecast model's own five categories
   (`Battery`, `Brakes`, `Electrical`, `Engine`, `Transmission`). Show them next to the predicted category, e.g.
   "Inspection heard: Brakes (worn brakes)". When they disagree, that is worth a technician's look.
3. **Safe to drive → a banner** on the forecast ("Not safe to drive until fixed: flat tyre; worn brakes").
4. **Hours → duration/ETA.** `work.totalHours` is the inspection's own estimate `[min, max]` in hours (body + mechanical,
   one job after another); `work.services` splits it per service type (`workshop.service_types.code`).
5. **Parts → the repair plan.** `parts` lists likely parts with quantity and what each is for.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `version` | `"inspection-handover-v1"` | changes if the format changes |
| `final` / `confirmedAt` | boolean / ISO time or null | confirmed by a technician, and when |
| `vehicle`, `jobId`, `inspectionNo` | | to link the forecast |
| `overallSeverity` | `minor` / `moderate` / `severe` / null | worst body damage (rule-v0) |
| `safeToDrive.safe` | boolean | false if anything is "fix before driving" (shattered glass, flat tyre, worn brakes, low oil) |
| `safeToDrive.reasons` | string[] | why, with where |
| `diagnosis` | string, at most 2,000 characters | one paragraph: sounds first, then body damage, then safety |
| `categoryHints[]` | `{ category, because[] }` | sound faults per forecast category (power steering has no category; body damage gives none) |
| `work.bodyHours` / `mechanicalHours` / `totalHours` | `[min, max]` or null | proposed workshop hours |
| `work.services[]` | `{ code, name, kind, priority, effortHours }` | `kind`: `body` or `mechanical`; `priority`: `before_driving` / `soon` / `planned` / `cosmetic` |
| `parts[]` | `{ part, quantity, for[], kind }` | proposed parts |
| `findings.damage[]`, `findings.sounds[]` | | the detail behind all of the above |
| `methods` | | `rule-v0`, `repair-v0`, `sound-repair-v0`, `parts-v0`; `validated: false` |

Sound fault → forecast category: worn brakes → **Brakes**; weak or flat battery → **Battery**; ignition problem, engine
misfire, tappet noise, low oil, worn belt → **Engine**.

## Example (INS-26-000044, shortened)

```json
{
  "version": "inspection-handover-v1",
  "inspectionNo": "INS-26-000044",
  "final": true,
  "safeToDrive": {
    "safe": false,
    "reasons": ["Shattered glass (windscreen; rear windscreen; right side, towards the rear)",
                "Flat tyre (right front tyre; right rear tyre)", "Worn brakes (heard while braking)"]
  },
  "diagnosis": "Damage inspection INS-26-000044 (technician-confirmed). Heard: ignition problem (while starting); power steering noise (while idling); worn brakes (while braking). Body damage: broken lamp x4 (...), shattered glass x3 (...), flat tyre x2 (...). Not safe to drive until fixed: ...",
  "categoryHints": [{ "category": "Brakes", "because": ["Worn brakes"] }, { "category": "Engine", "because": ["Ignition problem"] }],
  "work": { "bodyHours": [20, 42.5], "mechanicalHours": [3.5, 6.5], "totalHours": [23.5, 49], "services": ["..."] },
  "parts": [{ "part": "Lamp unit", "quantity": 4, "for": ["Broken lamp, left headlight", "..."], "kind": "body" },
            { "part": "Brake pads", "quantity": 1, "for": ["Worn brakes"], "kind": "mechanical" }],
  "methods": { "severity": "rule-v0", "repair": "repair-v0", "mechanical": "sound-repair-v0", "parts": "parts-v0", "validated": false }
}
```

## Limits

- Hours and parts are **proposals** (typical workshop values) until the service centre's technician confirms them: a
  guide, never a quote or an order.
- Body damage is from photos and sounds are from short recordings; both are checked by a technician before hand-over,
  but neither replaces a hands-on check.
- Code: `shared/backend/src/modules/inspections/inspections.handover.ts` (rules) and its tests.
