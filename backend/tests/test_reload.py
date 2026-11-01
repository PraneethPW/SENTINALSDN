import hashlib
from pathlib import Path
from app.detector import Detector
from app.config import settings


def test_good_model_followed_by_bad_reload_fails_closed(monkeypatch):
    path = Path("artifacts/model.joblib").absolute()
    monkeypatch.setenv("MODEL_PATH", str(path))
    monkeypatch.setenv("MODEL_SHA256", hashlib.sha256(path.read_bytes()).hexdigest())
    settings.cache_clear()
    model = Detector()
    model.load()
    assert model.status()["ready"]
    monkeypatch.setenv("MODEL_SHA256", "0" * 64)
    settings.cache_clear()
    model.load()
    assert not model.status()["ready"] and model.metadata is None
    settings.cache_clear()
