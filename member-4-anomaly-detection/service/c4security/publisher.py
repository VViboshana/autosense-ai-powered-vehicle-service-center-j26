"""Where `security.alert` events go: a JSONL file, an HTTP webhook of the integrated backend, and / or a callback."""
from __future__ import annotations

import json
import logging
import threading
import urllib.request
from pathlib import Path

log = logging.getLogger("c4security")


class AlertPublisher:
    def __init__(self, jsonl_path: str | Path | None = None, webhook_url: str | None = None, callback=None,
                 timeout_s: float = 3.0):
        self.jsonl_path = Path(jsonl_path) if jsonl_path else None
        self.webhook_url = webhook_url
        self.callback = callback
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        if self.jsonl_path:
            self.jsonl_path.parent.mkdir(parents=True, exist_ok=True)

    def publish(self, alert: dict):
        if self.jsonl_path:
            with self._lock, open(self.jsonl_path, "a") as fh:
                fh.write(json.dumps(alert) + "\n")
        if self.callback:
            self.callback(alert)
        if self.webhook_url:   # in a thread, so a slow backend never blocks the video loop
            threading.Thread(target=self._post, args=(alert,), daemon=True).start()

    def _post(self, alert):
        req = urllib.request.Request(self.webhook_url, data=json.dumps(alert).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=self.timeout_s).close()
        except Exception as e:  # the alert is still in the JSONL file
            log.warning("webhook failed for alert %s: %s", alert.get("alert_id"), e)
