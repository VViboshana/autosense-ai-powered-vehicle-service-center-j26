# CPU image. For an NVIDIA GPU use: FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime and run with --gpus all.
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt
COPY c4security c4security
COPY configs configs
COPY models models
ENV C4_DATA_DIR=/app/runs YOLO_CONFIG_DIR=/tmp/ultralytics
EXPOSE 8004
CMD ["uvicorn", "c4security.api:app", "--host", "0.0.0.0", "--port", "8004"]
