# Starts the Component 4 security service for the AutoSense web app (Cameras > Analyse a video). Windows PowerShell.
# Usage, from anywhere:  .\member-4-anomaly-detection\service\start.ps1      Stop with Ctrl+C.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path .venv\Scripts\uvicorn.exe)) {
    Write-Host "No virtual environment yet. Run once:  py -3.13 -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt pytest"
    exit 1
}
if (-not (Test-Path models\component4_best.pt)) {
    Write-Host "models\component4_best.pt is missing. Copy the models folder from component4-handover.zip into this folder."
    exit 1
}
if (-not $env:YOLO_CONFIG_DIR) { $env:YOLO_CONFIG_DIR = Join-Path $env:TEMP "Ultralytics" }
Write-Host "Security service on http://localhost:8004 (API docs: /docs). Keep this window open while you use the app."
& .venv\Scripts\uvicorn.exe c4security.service:app --host 127.0.0.1 --port 8004
