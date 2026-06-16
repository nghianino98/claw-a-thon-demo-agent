FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

RUN mkdir -p /data
EXPOSE 8080
ENV STATE_DIR=/data
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]

