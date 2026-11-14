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


def test_reference_reports_the_artifact_evaluation_threshold(benchmark_client, monkeypatch):
    client, _ = benchmark_client
    monkeypatch.setenv("DETECTION_THRESHOLD", "0.8")
    settings.cache_clear()
    reference = client.get("/api/benchmark/reference").json()
    assert reference["model"]["threshold"] == 0.525
    assert reference["confusion_matrix"] == [[2313, 52], [257, 1428]]


def test_upload_scores_labeled_and_unlabeled_windows(benchmark_client):
    client, _ = benchmark_client
    content = (
        "packet_rate,byte_rate,mean_packet_size,duration_seconds,protocol,interval_seconds,label\r\n"
        "31,6200,200,30,TCP,30,attack\r\n"
        "1,84,84,30,1,29,\r\n"
        "12,7200,600,15,UDP,30,benign\r\n"
    ).encode("utf-8-sig")
    response = client.post("/api/benchmark/upload", content=content, headers={"Content-Type": "text/csv"})
    assert response.status_code == 200
    run = response.json()
    assert run["dataset"]["kind"] == "upload"
    assert run["dataset"]["dataset_sha256"] == hashlib.sha256(content).hexdigest()
    assert [row[:2] for row in run["windows"]] == [[2, 1], [3, None], [4, 0]]
    assert [row[-1] for row in run["windows"]] == [6, 1, 17]
    assert all(0 <= row[2] <= 1 for row in run["windows"])


@pytest.mark.parametrize(("row", "reason"), [
    ("NaN,6200,200,30,TCP,30,attack", "packet_rate"),
    ("31,6200,200,30,HTTP,30,attack", "must use ICMP"),
    ("31,6200,200,30,TCP,15,attack", "within 5 seconds"),
    ("31,6200,200,30,TCP,30,unknown", "needs a label"),
    ("31,6200,200,30,TCP,30", "header column count"),
])
def test_upload_reports_invalid_rows(benchmark_client, row, reason):
    client, _ = benchmark_client
    header = "packet_rate,byte_rate,mean_packet_size,duration_seconds,protocol,interval_seconds,label"
    response = client.post(
        "/api/benchmark/upload", content=f"{header}\n{row}\n", headers={"Content-Type": "text/csv"}
    )
    assert response.status_code == 422
    assert "line 2" in response.json()["detail"]
    assert reason in response.json()["detail"]


def test_upload_rejects_unexpected_formats_and_payloads(benchmark_client):
    client, _ = benchmark_client
    assert client.post("/api/benchmark/upload", json={"content": "anything"}).status_code == 415
    response = client.post(
        "/api/benchmark/upload",
        content=b" " * 1_000_001,
        headers={"Content-Type": "text/csv"},
    )
    assert response.status_code == 413
