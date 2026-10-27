"""Integration tests use a dedicated real PostgreSQL DB. Fixtures never enter the app's DB."""

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.detector import detector
from app.main import app
from app.security import digest, passwords

TEST_URL = os.getenv("TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(
    not TEST_URL, reason="Set TEST_DATABASE_URL to a dedicated PostgreSQL _test database"
)
TOKEN = "integration-collector-token-with-at-least-32-characters"


@pytest.fixture
def client(monkeypatch):
    if "_test" not in TEST_URL.split("?")[0].rsplit("/", 1)[-1]:
        raise RuntimeError("Integration DB name must include _test; refusing destructive fixture cleanup")
    monkeypatch.setenv("DATABASE_URL", TEST_URL)
    monkeypatch.setenv("COLLECTOR_TOKEN", TOKEN)
    monkeypatch.setenv("MITIGATION_ENABLED", "true")
    monkeypatch.setenv("MODEL_PATH", "/nonexistent/test-model.joblib")
    settings.cache_clear()
    with psycopg.connect(TEST_URL) as conn:
        conn.execute(Path("app/schema.sql").read_text())
        conn.execute(
            "TRUNCATE ai_reports,audit_log,commands,incidents,flows,batches,collectors,ws_tickets,sessions,login_attempts,users RESTART IDENTITY CASCADE"
        )
        for role in ("admin", "viewer"):
            conn.execute(
                "INSERT INTO users(id,email,password_hash,role) VALUES (%s,%s,%s,%s)",
                (uuid4(), f"{role}@integration.test", passwords.hash("Integration-test-password!"), role),
            )
    detector.model = None
    detector.metadata = None
    with TestClient(app) as http:
        yield http
    settings.cache_clear()


def auth(client, role="admin"):
    response = client.post(
        "/api/auth/login",
        json={"email": f"{role}@integration.test", "password": "Integration-test-password!"},
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def batch():
    return {
        "batch_id": str(uuid4()),
        "collector_id": "integration-edge",
        "switches": ["1"],
        "controller_status": "connected",
        "flows": [
            {
                "observed_at": datetime.now(timezone.utc).isoformat(),
                "switch_id": "1",
                "source_ip": "10.1.0.1",
                "destination_ip": "10.1.0.2",
                "protocol": 6,
                "destination_port": 443,
                "packets": 200,
                "bytes": 20000,
                "interval_seconds": 5,
                "duration_seconds": 50,
            }
        ],
    }


def test_auth_real_ingestion_persistence_and_deduplication(client):
    assert client.get("/api/snapshot").status_code == 401
    payload = batch()
    assert client.post("/api/collector/batches", json=payload).status_code == 401
    headers = {"Authorization": f"Bearer {TOKEN}"}
    assert client.post("/api/collector/batches", json=payload, headers=headers).json()["accepted"] == 1
    assert client.post("/api/collector/batches", json=payload, headers=headers).json()["duplicate"]
    data = client.get("/api/snapshot", headers=auth(client)).json()
    assert data["summary"]["windows"] == 1
    assert data["summary"]["packets"] == 200
    assert data["flows"][0]["prediction"] == "unclassified"
    assert data["incidents"] == []
    assert data["collectors"][0]["online"] is True


def test_login_rate_limit_is_persisted(client):
    for _ in range(8):
        assert (
            client.post(
                "/api/auth/login", json={"email": "unknown@integration.test", "password": "wrong"}
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/api/auth/login", json={"email": "unknown@integration.test", "password": "wrong"}
        ).status_code
        == 429
    )


def test_websocket_ticket_single_use_and_revocation(client):
    headers = auth(client)
    ticket = client.post("/api/auth/ws-ticket", headers=headers).json()["ticket"]
    with client.websocket_connect(
        f"/api/live?ticket={ticket}", headers={"origin": "http://localhost:5173"}
    ) as socket:
        assert socket.receive_json()["summary"]["windows"] == 0
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            f"/api/live?ticket={ticket}", headers={"origin": "http://localhost:5173"}
        ):
            pass
    client.post("/api/auth/logout", headers=headers)
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_operator_roles_and_mitigation_command_lifecycle(client):
    client.post("/api/collector/batches", json=batch(), headers={"Authorization": f"Bearer {TOKEN}"})
    incident_id = uuid4()
    # A test-only incident fixture exercises actual DB command state transitions, not UI seed data.
    with psycopg.connect(TEST_URL) as conn:
        conn.execute(
            """INSERT INTO sentinel.incidents(id,collector_id,switch_id,source_ip,destination_ip,protocol,
            first_seen,last_seen,probability,packets,bytes,model_version) VALUES
            (%s,'integration-edge','1','10.1.0.1','10.1.0.2',6,now(),now(),0.99,200,20000,'test-only')""",
            (incident_id,),
        )
    viewer = auth(client, "viewer")
    assert client.post(f"/api/incidents/{incident_id}/mitigate", headers=viewer).status_code == 403
    admin = auth(client)
    response = client.post(f"/api/incidents/{incident_id}/mitigate", headers=admin)
    assert response.status_code == 200, response.text
    command_id = response.json()["id"]
    assert client.post(f"/api/incidents/{incident_id}/mitigate", headers=admin).status_code == 409
    collector = {"Authorization": f"Bearer {TOKEN}"}
    commands = client.get("/api/collector/integration-edge/commands", headers=collector).json()
    assert len(commands) == 1
    assert commands[0]["id"] == command_id
    assert (
        client.post(
            f"/api/collector/integration-edge/commands/{command_id}/result",
            headers=collector,
            json={"status": "enforced", "detail": "integration verification"},
        ).status_code
        == 200
    )
    response = client.post(f"/api/commands/{command_id}/revoke", headers=admin)
    assert response.status_code == 200, response.text
    revoke_id = response.json()["id"]
    client.get("/api/collector/integration-edge/commands", headers=collector)
    client.post(
        f"/api/collector/integration-edge/commands/{revoke_id}/result",
        headers=collector,
        json={"status": "revoked", "detail": "integration deletion verified"},
    )
    data = client.get("/api/snapshot", headers=admin).json()
    assert all(c["status"] == "revoked" for c in data["commands"])


def test_csv_export_and_provider_missing_state(client):
    headers = auth(client)
    response = client.get("/api/flows/export", headers=headers)
    assert response.status_code == 200
    assert "observed_at,switch_id,source_ip" in response.text
    assert (
        client.post(
            "/api/intelligence/explain", headers=headers, json={"incident_id": str(uuid4())}
        ).status_code
        == 503
    )


def test_chart_preserves_thirty_second_buckets_and_units(client):
    base = datetime.now(timezone.utc).replace(second=5, microsecond=0) - timedelta(minutes=1)
    for observed in (base, base + timedelta(seconds=30)):
        payload = batch()
        payload["flows"][0]["observed_at"] = observed.isoformat()
        response = client.post(
            "/api/collector/batches", headers={"Authorization": f"Bearer {TOKEN}"}, json=payload
        )
        assert response.status_code == 200
    data = client.get("/api/snapshot", headers=auth(client)).json()
    assert len(data["series"]) == 2
    assert all(abs(float(point["bps"]) - 20000 * 8 / 30) < 0.01 for point in data["series"])


def test_real_public_model_creates_and_groups_incident(client, monkeypatch):
    import hashlib
    from app.detector import detector

    artifact = Path("artifacts/model.joblib").absolute()
    monkeypatch.setenv("MODEL_PATH", str(artifact))
    monkeypatch.setenv("MODEL_SHA256", hashlib.sha256(artifact.read_bytes()).hexdigest())
    settings.cache_clear()
    detector.load()
    # Measured public Mendeley window; isolated test DB only, never live telemetry.
    # pktperflow=8641, byteperflow=9211306, dur=310, dur_nsec=738000000, Protocol=UDP.
    for _ in range(2):
        payload = batch()
        payload["flows"][0].update(
            protocol=17,
            destination_port=None,
            packets=8641,
            bytes=9211306,
            interval_seconds=30,
            duration_seconds=310.738,
        )
        response = client.post(
            "/api/collector/batches", headers={"Authorization": f"Bearer {TOKEN}"}, json=payload
        )
        assert response.status_code == 200
    data = client.get("/api/snapshot", headers=auth(client)).json()
    assert len(data["incidents"]) == 1
    assert data["incidents"][0]["probability"] > 0.95
    assert data["incidents"][0]["packets"] == 17282
    assert all(flow["prediction"] == "attack" for flow in data["flows"])


def test_retention_removes_expired_measurements_and_preserves_fresh_data(client):
    from app.maintenance import run_cleanup

    for _ in range(2):
        client.post("/api/collector/batches", headers={"Authorization": f"Bearer {TOKEN}"}, json=batch())
    with psycopg.connect(TEST_URL) as conn:
        conn.execute(
            "UPDATE sentinel.flows SET observed_at=now()-interval '8 days' WHERE id=(SELECT min(id) FROM sentinel.flows)"
        )
    client.portal.call(run_cleanup)
    with psycopg.connect(TEST_URL) as conn:
        assert conn.execute("SELECT count(*) FROM sentinel.flows").fetchone()[0] == 1
        assert (
            conn.execute(
                "SELECT count(*) FROM sentinel.audit_log WHERE action='retention.completed'"
            ).fetchone()[0]
            == 1
        )
