import hashlib
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.benchmark import load_partition
from app.config import settings
from app.main import app


@pytest.fixture
def benchmark_client(monkeypatch):
    path = Path("artifacts/model.joblib").absolute()
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("MODEL_PATH", str(path))
    monkeypatch.setenv("MODEL_SHA256", hashlib.sha256(path.read_bytes()).hexdigest())
    monkeypatch.setenv("DETECTION_THRESHOLD", "0.525")
    settings.cache_clear()
    try:
        with TestClient(app) as client:
            yield client, path
    finally:
        settings.cache_clear()


def test_public_benchmark_recalculates_the_installed_models_holdout(benchmark_client):
    client, path = benchmark_client
    response = client.post("/api/benchmark/run")
    assert response.status_code == 200
    run = response.json()
    metadata = json.loads(path.with_suffix(".json").read_text())
    assert run["model"]["version"] == metadata["version"]
    assert run["dataset"]["dataset_sha256"] == metadata["dataset_sha256"]
    assert run["dataset"]["groups"] == 30
    assert len({row[0] for row in run["windows"]}) == 4050
    results = [[0, 0], [0, 0]]
    for _, label, score, *_ in run["windows"]:
        results[label][int(score >= run["model"]["threshold"])] += 1
    assert results == metadata["confusion_matrix"] == [[2313, 52], [257, 1428]]


def test_benchmark_rejects_modified_archive(tmp_path):
    artifacts = Path("artifacts")
    manifest = json.loads((artifacts / "benchmark.json").read_text())
    (tmp_path / "benchmark.json").write_text(json.dumps(manifest))
    (tmp_path / "benchmark.csv.gz").write_bytes(b"invalid")
    with pytest.raises(ValueError, match="does not match"):
        load_partition(tmp_path / "model.joblib", manifest["dataset_sha256"], 4050, 30, 30)
