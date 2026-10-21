#!/usr/bin/env bash
# Starts the Component 4 security service for the AutoSense web app (Cameras > Analyse a video).
# Usage, from anywhere:  ./member-4-anomaly-detection/service/start.sh      Stop with Ctrl+C.
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/uvicorn ]; then
  echo "No virtual environment yet. Run once:  python3.13 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest"
  exit 1
fi
export YOLO_CONFIG_DIR="${YOLO_CONFIG_DIR:-/tmp/Ultralytics}"
echo "Security service on http://localhost:8004 (API docs: /docs). Keep this window open while you use the app."
exec .venv/bin/uvicorn c4security.service:app --host 127.0.0.1 --port 8004
