import hashlib
from pathlib import Path

from app.config import settings
from app.detector import Detector
from app.schemas import Flow
from test_validation import sample


def test_native_environment_example_trusts_the_committed_model():
    example = dict(line.split("=", 1) for line in Path(".env.example").read_text().splitlines()
                   if line and not line.startswith("#") and "=" in line)
    assert example["MODEL_SHA256"] == hashlib.sha256(Path(example["MODEL_PATH"]).read_bytes()).hexdigest()


def test_artifact_hash_mismatch_blocks_deserialization(monkeypatch):
    monkeypatch.setenv("MODEL_PATH", str(Path("artifacts/model.joblib").absolute()))
    monkeypatch.setenv("MODEL_SHA256", "0" * 64)
    settings.cache_clear()
    model = Detector()
    model.load()
    assert not model.status()["ready"]
    assert "mismatched" in model.error
    settings.cache_clear()


def test_public_model_abstains_for_incompatible_sampling_window(monkeypatch):
    path = Path("artifacts/model.joblib").absolute()
    monkeypatch.setenv("MODEL_PATH", str(path))
    monkeypatch.setenv("MODEL_SHA256", hashlib.sha256(path.read_bytes()).hexdigest())
    settings.cache_clear()
    model = Detector()
    model.load()
    assert model.status()["ready"]
    assert model.predict([Flow(**sample(interval_seconds=5))]) == [("unclassified", None)]
    verdict, probability = model.predict([Flow(**sample(interval_seconds=30))])[0]
    assert verdict in ("attack", "benign") and 0 <= probability <= 1
    settings.cache_clear()
