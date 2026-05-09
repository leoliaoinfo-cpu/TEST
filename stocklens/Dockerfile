FROM python:3.11-slim

# Install CJK fonts for matplotlib charts
RUN apt-get update && \
    apt-get install -y --no-install-recommends fonts-noto-cjk && \
    fc-cache -f -v && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-clear matplotlib font cache so it rebuilds with Noto fonts
RUN python -c "import matplotlib; matplotlib.font_manager._load_fontmanager(try_read_cache=False)" 2>/dev/null || true

COPY . .

CMD ["python", "main.py"]
