# Glass: how sure must the model be? (CarDD test set)

Damage model `best.pt`, 374 test photos, 71 real shattered-glass regions, 16 glass regions found where there is no shattered glass (false alarms, from 0.10 up).
A region counts as found when its box overlaps the real one by IoU >= 0.5.

| Bar | Real glass: finding | Real glass: possible damage | Real glass: missed | False alarms as findings |
|---|---|---|---|---|
| 0.25 (today) | 71 (100%) | 0 | 0 | 12 of 16 |
| 0.30 | 71 (100%) | 0 | 0 | 12 of 16 |
| 0.35 | 70 (99%) | 1 | 0 | 10 of 16 |
| 0.40 | 70 (99%) | 1 | 0 | 9 of 16 |
| 0.45 | 70 (99%) | 1 | 0 | 7 of 16 |
| 0.50 | 70 (99%) | 1 | 0 | 6 of 16 |
| 0.55 | 69 (97%) | 2 | 0 | 5 of 16 |
| 0.60 | 69 (97%) | 2 | 0 | 5 of 16 |
| 0.65 | 69 (97%) | 2 | 0 | 3 of 16 |
| 0.70 **(chosen)** | 68 (96%) | 3 | 0 | 3 of 16 |

**Rule:** the highest bar that keeps at least 95% of the real shattered glass that is a finding today (71 regions at 0.25). Glass below the bar is not lost: it is shown as possible damage.

Confidences of real glass (sorted): 0.32, 0.54, 0.68, 0.75, 0.75, 0.75, 0.75, 0.83, 0.84, 0.86, 0.88, 0.88, 0.90, 0.90, 0.90, 0.91, 0.91, 0.91, 0.91, 0.91, 0.91, 0.91, 0.91, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.93, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.94, 0.95

Confidences of false alarms (sorted): 0.12, 0.16, 0.18, 0.18, 0.30, 0.32, 0.39, 0.40, 0.41, 0.46, 0.52, 0.63, 0.64, 0.77, 0.82, 0.91

## Decision (2026-10-26)

Bar set to **0.70** (`DAMAGE_GLASS_CONFIDENCE`). Bars above 0.70 were not considered: four real shattered-glass regions
sit at exactly 0.75, so a higher bar would depend on a rounding of the confidence.

Limits: "false alarms" here are glass regions with no shattered glass under them in CarDD (reflections, intact glass, and
some partial duplicates of real glass), only 16 of them; CarDD photos are close-ups, phone photos at the centre may score
lower. On the app's own photos (shared database, 2026-10-26): the doubtful front windscreens (0.32, 0.34, 0.61) now become
possible damage for the technician; the real shattered rear windows (0.88, 0.90) stay findings.
