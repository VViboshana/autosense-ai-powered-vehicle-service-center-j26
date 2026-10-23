"""Rule engine: tracked detections of one camera -> `security.alert` events.

Pure Python (no model), so it can be unit-tested and fed by any detector / tracker.
Input per frame: list of {"cls", "conf", "box": (x0, y0, x1, y1) pixels, "id": track id or None}.
Workers are never alerted for tampering, loitering or access (normal work). Fire, smoke and weapons alert for anyone.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import cv2
import numpy as np
import yaml

LEVELS = ["Low", "Medium", "High", "Critical"]
GAP_S = 1.0          # evidence may disappear this long without resetting a timer (missed detections)
FACE_MEMORY_S = 5.0  # a person counts as face-covered for this long after the last face_covered detection


def iou(a, b):
    ix0, iy0, ix1, iy1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def overlap_of(a, b):
    """Share of box a covered by box b."""
    ix0, iy0, ix1, iy1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    area = (a[2] - a[0]) * (a[3] - a[1])
    return inter / area if area > 0 else 0.0


def gap(a, b):
    """Distance in pixels between two boxes (0 if they touch / overlap)."""
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return float(np.hypot(dx, dy))


def raise_level(level, steps=1):
    return LEVELS[min(len(LEVELS) - 1, LEVELS.index(level) + steps)]


def load_rules(path, overrides=()):
    """Read threat_rules.yaml; overrides like 'loitering.dwell_s=20' (threat names may skip 'threats.')."""
    cfg = yaml.safe_load(open(path))
    for s in overrides:
        dotted, value = s.split("=", 1)
        keys = dotted.split(".")
        node = cfg if keys[0] in cfg else cfg["threats"]
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        node[keys[-1]] = yaml.safe_load(value)
    return cfg


class Timer:
    """Continuous-evidence timer with a short gap tolerance."""

    def __init__(self):
        self.start = self.last = None

    def update(self, present, t):
        if present:
            if self.start is None or t - self.last > GAP_S:
                self.start = t
            self.last = t
        elif self.last is not None and t - self.last > GAP_S:
            self.start = self.last = None

    def duration(self, t):
        return 0.0 if self.start is None or t - self.last > GAP_S else self.last - self.start


class ThreatEngine:
    """State of one camera. Call `process(t, dets)` for every analysed frame, in time order."""

    def __init__(self, cfg, zones, width, height, clock0: datetime | None = None, source=None):
        self.cfg, self.W, self.H = cfg, width, height
        self.camera_id = zones.get("camera_id") or (Path(str(source)).stem if source else "camera")
        self.source = source
        self.bays = dict(zones.get("bays", {}))   # zone -> {job_id, plate, ...}; updated by bay.state
        self.poly = {kind: [(z["name"], (np.array(z["points"]) * [width, height]).astype(np.int32))
                            for z in zones.get(kind, [])] for kind in ("restricted", "public")}
        self.near_px = cfg["near_vehicle_px_ratio"] * width
        self.clock0 = clock0
        self.timers = defaultdict(Timer)
        self.last_alert = {}
        self.face_seen = {}
        self.roles = defaultdict(lambda: [0, 0])
        self.n_alerts = 0

    # ---------------------------------------------------------------- Component 1 link
    def update_bay(self, zone, info: dict | None):
        """bay.state: a job entered (info) or left (None) a bay / restricted zone."""
        if info:
            self.bays[zone] = info
        else:
            self.bays.pop(zone, None)

    # ---------------------------------------------------------------- helpers
    def _zone_at(self, pt):
        return next((n for n, pg in self.poly["restricted"]
                     if cv2.pointPolygonTest(pg, (float(pt[0]), float(pt[1])), False) >= 0), None)

    def _after_hours(self, t):
        if self.clock0 is None:
            return False
        now = (self.clock0 + timedelta(seconds=t)).time()
        a, b = (datetime.strptime(self.cfg["after_hours"][k], "%H:%M").time() for k in ("start", "end"))
        return now >= a or now < b if a > b else a <= now < b

    def _bay_of(self, v):
        zone = self._zone_at(((v["box"][0] + v["box"][2]) / 2, v["box"][3]))
        info = {"vehicle_track_id": v["id"], "zone": zone}
        if zone in self.bays:
            info.update(self.bays[zone])
        return info

    def filter(self, dets):
        det = self.cfg["detection"]
        aliases = self.cfg.get("class_aliases", {})
        out = []
        for d in dets:
            name = aliases.get(d["cls"], d["cls"])
            if d["conf"] >= det.get("class_conf", {}).get(name, det["conf"]):
                out.append({**d, "cls": name})
        return out

    # ---------------------------------------------------------------- main step
    def process(self, t, dets, frame_idx=0):
        """t = seconds since the stream started. Returns (annotated detections, new alerts)."""
        cfg, near_px = self.cfg, self.near_px
        dets = self.filter(dets)
        by = defaultdict(list)
        for d in dets:
            by[d["cls"]].append(d)
        persons, vehicles, workers = by["person"], by["vehicle"], by["worker"]

        for i, p in enumerate(persons):
            pid = p["id"] if p["id"] is not None else f"f{frame_idx}_{i}"
            p["pid"] = pid
            is_w = any(iou(p["box"], w["box"]) >= cfg["role"]["worker_iou"] or overlap_of(w["box"], p["box"]) > 0.7
                       for w in workers)
            self.roles[pid][0] += is_w
            self.roles[pid][1] += 1
            p["role"] = "worker" if self.roles[pid][0] / self.roles[pid][1] >= 0.5 else "visitor"
            x0, y0, x1, y1 = p["box"]
            for f in by["face_covered"]:
                fx, fy = (f["box"][0] + f["box"][2]) / 2, (f["box"][1] + f["box"][3]) / 2
                if x0 <= fx <= x1 and y0 <= fy <= y0 + 0.5 * (y1 - y0):
                    self.face_seen[pid] = t
            p["face"] = t - self.face_seen.get(pid, -1e9) <= FACE_MEMORY_S
            p["near"] = [v for v in vehicles if gap(p["box"], v["box"]) <= near_px]
            p["touch"] = [v for v in vehicles if overlap_of(p["box"], v["box"]) >= 0.10]
            for cls in ("tampering", "loitering"):
                p[cls] = max((b["conf"] for b in by[cls] if iou(p["box"], b["box"]) >= 0.3
                              or overlap_of(b["box"], p["box"]) >= 0.6), default=0.0)
            p["zone"] = self._zone_at(((x0 + x1) / 2, y1))
        visitors = [p for p in persons if p["role"] == "visitor"]
        worker_people = [p for p in persons if p["role"] == "worker"]

        def near_people(bxs):
            return [p for p in persons if any(gap(p["box"], b) <= near_px for b in bxs)]

        cands = []
        for cls in ("fire", "smoke", "weapon"):
            present = bool(by[cls])
            self.timers[(cls, "scene")].update(present, t)
            if present:
                bxs = [b["box"] for b in by[cls]]
                hit_v = [v for v in vehicles if any(gap(v["box"], b) <= near_px for b in bxs)]
                cands.append((cls, "scene", {"conf": max(b["conf"] for b in by[cls]), "vehicles": hit_v,
                                             "people": near_people(bxs), "boxes": bxs, "person": None,
                                             "on_vehicle": bool(hit_v)}))
        th = cfg["threats"]
        for p in visitors:
            pid = p["pid"]
            model_tamper = p["tampering"] > 0
            self.timers[("tampering", pid)].update(model_tamper, t)
            self.timers[("touch", pid)].update(bool(p["touch"]), t)
            if model_tamper or self.timers[("touch", pid)].duration(t) >= th["tampering"]["touch_s"]:
                cands.append(("tampering", pid, {"conf": p["tampering"] or p["conf"], "vehicles": p["touch"] or p["near"],
                                                 "people": [p], "boxes": [p["box"]], "person": p, "model": model_tamper}))
            model_loiter = p["loitering"] > 0
            self.timers[("loitering", pid)].update(model_loiter, t)
            worker_near = any(gap(p["box"], w["box"]) <= near_px for w in worker_people)
            self.timers[("dwell", pid)].update(bool(p["near"]) and not worker_near, t)
            if model_loiter or self.timers[("dwell", pid)].duration(t) >= th["loitering"]["dwell_s"]:
                cands.append(("loitering", pid, {"conf": p["loitering"] or p["conf"], "vehicles": p["near"],
                                                 "people": [p], "boxes": [p["box"]], "person": p, "model": model_loiter}))
            in_zone = p["zone"] is not None and not worker_near
            self.timers[("unauthorised_access", pid)].update(in_zone, t)
            if in_zone:
                cands.append(("unauthorised_access", pid, {"conf": p["conf"], "vehicles": p["near"], "people": [p],
                                                           "boxes": [p["box"]], "person": p, "zone": p["zone"]}))

        alerts = []
        for threat, key, ev in cands:
            rule = th[threat]
            tm = self.timers.get((threat, key))
            if threat in ("tampering", "loitering") and not ev.get("model"):
                pass  # the touch / dwell timer already enforced its own (longer) duration
            elif tm is None or tm.duration(t) < cfg["persistence_s"]:
                continue
            sev, reasons = rule["base"], []
            rif = rule.get("raise_if", {})
            p = ev["person"]
            if rif.get("face_covered") and p is not None and p["face"]:
                reasons.append("face covered")
            if rif.get("after_hours") and self._after_hours(t):
                reasons.append("after hours")
            if rif.get("near_vehicle") and ev["vehicles"]:
                reasons.append("near a vehicle")
            if rif.get("on_vehicle") and ev.get("on_vehicle"):
                reasons.append("on / next to a vehicle")
            if rif.get("lasts_s") and tm is not None and tm.duration(t) >= rif["lasts_s"]:
                reasons.append(f"lasting > {rif['lasts_s']} s")
            if rif.get("group_size") and threat == "tampering":
                n = sum(1 for q in visitors if q["touch"] or q["tampering"] > 0)
                if n >= rif["group_size"]:
                    reasons.append(f"{n} visitors together")
            if reasons:
                sev = raise_level(sev)
            prev = self.last_alert.get((threat, key))
            if prev and t - prev[0] < cfg["cooldown_s"] and LEVELS.index(sev) <= LEVELS.index(prev[1]):
                continue
            self.last_alert[(threat, key)] = (t, sev)
            self.n_alerts += 1
            clock = self.clock0 + timedelta(seconds=t) if self.clock0 else None
            alert = {
                "event": "security.alert", "alert_id": uuid.uuid4().hex[:12], "threat_type": threat,
                "severity": sev,
                "escalated_from": prev[1] if prev and LEVELS.index(sev) > LEVELS.index(prev[1]) else None,
                "confidence": round(float(ev["conf"]), 3), "camera_id": self.camera_id,
                "zone": ev.get("zone") or (p["zone"] if p is not None else None),
                "source": self.source, "video_time_s": round(t, 1),
                "clock_time": clock.isoformat(timespec="seconds") if clock else None,
                "person_track_id": p["id"] if p is not None else None,
                "person_role": p["role"] if p is not None else None,
                "affected_vehicles": [self._bay_of(v) for v in ev["vehicles"]],
                "affected_persons": len({q["pid"] for q in ev["people"]}),
                "reasons": reasons or ["base rule"],
                "notify_roles": list(dict.fromkeys(rule["notify"] + cfg["notify_by_severity"][sev])),
                "status": "open", "snapshot": f"snapshots/{self.n_alerts:03d}_{threat}.jpg",
                "processed_at": datetime.now().isoformat(timespec="seconds"),
                "_boxes": ev["boxes"],   # removed before publishing; used for the snapshot
            }
            alerts.append(alert)
        return dets, alerts

    def worker_ids(self):
        return sorted(str(k) for k, (w, n) in self.roles.items() if n and w / n >= 0.5 and not str(k).startswith("f"))

    def tracked_people(self):
        return len([k for k in self.roles if not str(k).startswith("f")])
