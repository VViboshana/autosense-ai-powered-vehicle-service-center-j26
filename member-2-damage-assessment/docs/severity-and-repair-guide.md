# Severity and repair guide

Component 2 (vehicle damage assessment), AutoSense AI, J26-IT-306.

This document answers the PP1 panel's recommendations:
- **Severity:** "clearly define how severity levels will be determined".
- **Extension:** "recommend repair priority, required service category and estimated repair effort based on the
  detected damage".

It describes what the system does now. The rules live in code, and this text must match them:
- **Severity:** `backend/app/severity_rules.json` and `backend/app/severity.py` (method **rule-v0**).
- **Repair guide:** `shared/backend/src/modules/inspections/inspections.repair.ts` (method **repair-v0**).

## 1. The pipeline at a glance

```
photo ─► damage model (YOLO11n-seg, CarDD) ─► damage regions (type, outline)
      ─► vehicle model (COCO YOLO11n-seg)  ─► the inspected vehicle's outline
              │
              ▼
   severity rule (rule-v0): damage type + size on the vehicle ─► minor / moderate / severe / not graded
              │
              ▼
   technician reviews every region: confirm, correct the type or severity, reject, or add missed damage
              │
              ▼
   repair guide (repair-v0), from the FINAL type and severity:
   priority ─ service category ─ estimated effort (hours)
```

Every step is a fixed rule that can be read and explained. The AI only finds and outlines the damage. **The
technician has the final say on type and severity, and the repair guide follows their decision.**

## 2. Severity levels: what each level means

| Level | Meaning (in repair terms) | Typical repair |
|---|---|---|
| **Minor** | Small and on the surface; affects only appearance. | Polish, touch-up, paintless dent repair. |
| **Moderate** | Clearly visible damage that needs repair or refinishing; or a part that must be fixed to be roadworthy (a broken lamp). | Filler and refinish the panel, plastic repair, replace a lamp. |
| **Severe** | Large damage where the part usually needs replacing, or damage that makes the car unsafe to drive (broken glass, flat tyre). | Replace the panel or bumper, replace the glass, fix the tyre. |
| **Not graded** | The size cannot be judged from the photo (no vehicle found). | The technician grades it. |

## 3. How severity is determined (rule-v0)

**Inputs, for each damage region:**
1. **Damage type**, from the model: dent, scratch, crack, shattered glass, broken lamp or flat tyre.
2. **Size on the vehicle** = damage area ÷ vehicle area, both measured in pixels on the same photo. The vehicle comes
   from a second model that finds the car (the largest car, motorcycle, bus or truck in the photo).

**Steps:**
1. **Is the damage on the inspected vehicle?** If less than 50% of the region lies inside the vehicle's outline (e.g.
   damage on a car in the background), it is kept for staff to see but **not graded and not counted**.
2. **Safety parts are graded by type, whatever their size**, because a small break still matters:

   | Type | Severity | Why |
   |---|---|---|
   | Shattered glass | Severe | Affects visibility and safety; the glass must be replaced. |
   | Flat tyre | Severe | The vehicle is not safe to drive until the tyre is fixed. |
   | Broken lamp | Moderate | It must be replaced for the vehicle to be roadworthy. |

3. **Body damage is graded by size bands:**

   | Type | Minor | Moderate | Severe |
   |---|---|---|---|
   | Dent | under 1% of the vehicle | 1% to under 5% | 5% or more |
   | Scratch | under 3% | 3% or more | (not used: a scratch alone is not severe) |
   | Crack | (not used: a crack is at least moderate) | under 5% | 5% or more |

4. **Not graded:** if no vehicle is found, the size can't be measured, so the region is "not graded" and the reason
   says so.
5. **Warning:** if only part of the vehicle is in the photo (the car touches the photo's edge), the region is still
   graded, but the reason warns that the share may be overstated.
6. **Overall severity of the inspection** = the worst graded region. Possible damage (low confidence) does not count
   until the technician accepts it.
7. **Every region carries a one-line reason**, e.g. "dent covers 2.1% of the vehicle (under 1% minor, under 5% moderate,
   else severe)".
8. **The model's confidence never changes the severity.** Confidence says how sure the model is that damage is
   there, not how bad it is.

**Why rules and not a trained severity model:** the CarDD dataset has no severity labels, so a model would have
nothing reliable to learn from. Rules can be checked, explained and corrected. The technician confirms or corrects
every grade, and those decisions are the data for calibrating the rules (section 7).

**Status:** the thresholds are **proposed** (rule-v0) and not yet validated with the service centre's technician. The
system shows "not yet validated" wherever severity appears.

## 4. Repair priority (repair-v0)

Worked out from the final damage type and severity of each damaged area:

| Priority | When | Shown to the customer as |
|---|---|---|
| **Fix before driving** | Shattered glass, flat tyre (any severity) | "Please have this fixed before you drive the car again." |
| **Fix soon** | Broken lamp; any severe body damage | "Book a repair soon, before it gets worse." |
| **Can be planned** | Moderate body damage; damage that could not be graded | "It needs repair, but it can wait for a convenient time." |
| **Cosmetic** | Minor damage | "Only affects how the car looks. Repair when convenient." |

The inspection's priority is its **most urgent area**.

## 5. Required service category

| Damage type | Service (workshop.service_types) |
|---|---|
| Dent, scratch, crack | Body repair (`BODY_REPAIR`) |
| Shattered glass | Glass replacement (`GLASS_REPLACEMENT`) |
| Broken lamp | Lighting repair (`LIGHTING_REPAIR`) |
| Flat tyre | Tyre service (`TYRE_SERVICE`) |

The plan lists each service needed, how many areas it covers, and its priority: the most urgent services first, then
the most work.

## 6. Estimated repair effort

Workshop hours per damaged area, as a range. **These are proposed typical body-shop times, not yet confirmed by the
service centre's technician.**

| Type | Minor | Moderate | Severe |
|---|---|---|---|
| Dent | 0.5–1 h (paintless repair) | 1.5–3 h (filler, refinish) | 4–8 h (replace or rebuild the panel) |
| Scratch | 0.5–1 h (polish) | 1.5–3 h (refinish the panel) | 3–5 h (repaint several panels) |
| Crack | 0.5–1 h | 1.5–3 h (plastic repair, refinish) | 2–4 h (replace the bumper or panel) |
| Shattered glass | 1.5–3 h (replace, adhesive cure), any severity | | |
| Broken lamp | 0.5–1.5 h (replace the unit), any severity | | |
| Flat tyre | 20–45 min (repair or replace), any severity | | |

- **Totals:** the inspection's total adds up the areas, assuming they are repaired one after another, so it's an upper
  bound when work runs in parallel.
- **Not graded:** areas that could not be graded get no estimate, and the system says how many.
- **Staff** see the hour ranges.
- **Customers** see only rough words ("A few hours", "About a day", "About two days", "Several days") and never a
  price. The report says it's "a guide from the inspection, not a quote".

**Overlapping regions count once.** The model often outlines one damage in several overlapping pieces, for example a
long crack as five regions. Before the plan is made, overlapping regions with the same damage type on the same photo
are joined into one damaged area, graded by its worst piece. So one crack is one repair, not five.

## 7. How it will be validated (after PP1)

1. **Severity calibration (rule-v0 → rule-v1):**
   - The technician grades about 50 real damage regions without seeing the system's grade.
   - Compare with rule-v0 using a confusion matrix and **weighted Cohen's kappa** (the "Test set vs real use" page
     already shows the severity agreement heatmap from the technician's corrections).
   - Adjust the size bands to the technician's grades and report agreement before and after. Keep rule-v0 for
     comparison.
2. **Priority and service:** the technician checks the suggestion for the same sample. Report the share they accept
   unchanged.
3. **Effort:** replace the proposed hours with the technician's figures (repair-v1). Once jobs record actual repair
   times, report the mean absolute error between estimated and actual hours.

## 8. Limitations

- **Depth isn't visible:** a photo shows area, not depth. A deep dent and a shallow one of the same size get the same
  grade, so the technician corrects these.
- **Area depends on the camera:** the angle and distance change the measured share. The capture guide asks for
  straight-on photos of each side, and the vehicle must be found in the photo.
- **Six damage types only:** the classes come from CarDD (dent, scratch, crack, glass, lamp, tyre). Rust, paint fade
  and mechanical damage are not covered.
- **Unvalidated values:** the thresholds and hours are proposed until section 7 is done, and the system labels them so.
- **Calculated on read:** the repair guide is worked out each time it's shown from the stored final type and severity,
  so a later rule version would change old reports. Storing a snapshot at confirmation is planned once the rules are
  validated.

## 9. Where it appears in the system

- **Staff review screen:**
  - A "Repair guide" card shows the overall priority, a table of services (areas, priority, hours) and the total. It
    updates as regions are reviewed.
  - Each region shows its priority, service and hours.
- **Customer report:**
  - A "What needs doing" box shows the priority with advice, and each service with a rough time.
  - Each area shows its priority.
  - The severity explanation uses the definitions in section 2.
- **Customer home:** the latest inspection chip leads with the priority, e.g. "Fix before driving".
