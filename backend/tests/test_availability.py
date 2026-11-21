import hashlib
from pathlib import Path
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from psycopg import OperationalError

from app.config import settings
from app.db import db
from app.main import app
import app.main as main


def test_database_outage_preserves_real_public_evaluation_and_reports_workspace_failure(monkeypatch):
    path = Path("artifacts/model.joblib").absolute()
    for key, value in {
        "ENVIRONMENT": "development", "DATABASE_URL": "postgresql://unavailable/sentinel",
        "MODEL_PATH": str(path), "MODEL_SHA256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "CORS_ORIGINS": "http://localhost:5173",
    }.items():
        monkeypatch.setenv(key, value)
    settings.cache_clear()
    monkeypatch.setattr(db, "open", AsyncMock(side_effect=OperationalError("provider unavailable")))
    try:
        with TestClient(app) as client:
            origin = {"Origin": "http://localhost:5173"}
            assert client.get("/health/live").json()["workspace_ready"] is False
            public = client.get("/health/public")
            assert public.status_code == 200
            assert public.json()["mode"] == "public-evaluation-only"
            assert client.get("/health/ready").status_code == 503
            assert client.get("/api/benchmark/reference", headers=origin).status_code == 200
            run = client.post("/api/benchmark/run", headers=origin)
            assert run.status_code == 200 and len(run.json()["windows"]) == 4050
            assert run.headers["access-control-allow-origin"] == origin["Origin"]
            unavailable = client.post("/api/auth/login", json={"email": "test@example.test", "password": "test-only"}, headers=origin)
            assert unavailable.status_code == 503
            assert "temporarily unavailable" in unavailable.json()["detail"]
            assert unavailable.headers["access-control-allow-origin"] == origin["Origin"]
            assert client.get("/api/snapshot").status_code == 503
    finally:
        settings.cache_clear()


async def test_workspace_is_exposed_only_after_migrations_and_bootstrap_finish(monkeypatch):
    events = []
    async def record(name):
        assert not app.state.workspace_ready
        events.append(name)
    monkeypatch.setenv("DATABASE_URL", "postgresql://test/sentinel_test")
    settings.cache_clear()
    app.state.workspace_ready = False
    monkeypatch.setattr(db, "open", lambda: record("connect"))
    monkeypatch.setattr(main, "apply_migrations", lambda: record("migrate"))
    monkeypatch.setattr(main, "ensure_local_account", lambda: record("bootstrap"))
    try:
        await main.initialize_workspace()
        assert events == ["connect", "migrate", "bootstrap"]
        assert app.state.workspace_ready
    finally:
        app.state.workspace_ready = False
        settings.cache_clear()


async def test_background_recovery_retries_until_database_returns(monkeypatch):
    app.state.workspace_ready = False
    attempts = 0
    async def reconnect():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise OperationalError("provider unavailable")
        app.state.workspace_ready = True
    monkeypatch.setattr(main, "initialize_workspace", reconnect)
    monkeypatch.setattr(main.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(db, "close", AsyncMock())
    try:
        await main.recover_workspace()
        assert attempts == 2
        db.close.assert_awaited_once()
    finally:
        app.state.workspace_ready = False
