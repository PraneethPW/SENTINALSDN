FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* && useradd --create-home --uid 10001 sentinel
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY app ./app
COPY collector ./collector
COPY lab ./lab
COPY artifacts ./artifacts
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh && chown -R sentinel:sentinel /app
USER sentinel
EXPOSE 8000
CMD ["./entrypoint.sh"]
