"""Lifecycle boundaries against real PostgreSQL; synthetic payloads are test-only."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
import psycopg
import pytest
from app.config import settings
from test_api import TEST_URL, auth, batch, client as client

pytestmark = pytest.mark.skipif(not TEST_URL, reason="Dedicated test PostgreSQL required")
HOST_TOKEN = "private-integration-lab-host-token-000000000000"


def sql(query, params=()):
    with psycopg.connect(TEST_URL) as conn:
        conn.execute("SET LOCAL search_path TO sentinel")
        cursor = conn.execute(query, params)
        return cursor.fetchall() if cursor.description else []


@pytest.fixture
def host(client, monkeypatch):
    monkeypatch.setenv("LAB_HOST_TOKEN", HOST_TOKEN)
    settings.cache_clear()
    headers = {"Authorization": "Bearer " + HOST_TOKEN}
    assert (
        client.post(
            "/api/lab-host/poll", headers=headers, json={"ready": True, "capacity": 2, "version": "test"}
        ).status_code
        == 200
    )
    return headers


def owner(client, label=None):
    label = label or uuid4().hex[:8]
    response = client.post(
        "/api/auth/register",
        json={
            "display_name": "Lab tester",
            "email": label + "@lab.test",
            "password": "Integration-lab-password!",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": "Bearer " + response.json()["token"]}


def start(client, headers, path="start", request_id=None):
    return client.post(
        "/api/workspace/lab/" + path, headers=headers, json={"request_id": request_id or str(uuid4())}
    )


def claim(client, host, run):
    response = client.post(
        f"/api/lab-host/runs/{run['id']}/claim", headers=host, json={"revision": run["revision"]}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_permissions_and_offline_host(client):
    assert start(client, {}).status_code == 401
    assert start(client, auth(client, "viewer")).status_code == 403
    assert start(client, auth(client)).status_code == 503
    assert (
        client.post("/api/lab-host/poll", json={"ready": True, "capacity": 2, "version": "test"}).status_code
        == 401
    )


def test_idempotency_private_scope_and_no_secret_exposure(client, host):
    first, other = owner(client), owner(client)
    key = str(uuid4())
    a = start(client, first, request_id=key)
    assert a.status_code == 200, a.text
    assert start(client, first, request_id=key).json()["run"]["id"] == a.json()["run"]["id"]
    assert start(client, first).json()["run"]["id"] == a.json()["run"]["id"]
    mine = client.get("/api/snapshot", headers=first)
    assert "token_hash" not in mine.text and "collector_token" not in mine.text
    assert client.get("/api/workspace/lab", headers=other).json()["run"] is None
    assert len(sql("SELECT id FROM managed_labs")) == 1
    assert client.post("/api/workspace/lab/stop", headers=other).json()["run"] is None
    assert sql("SELECT desired_state FROM managed_labs")[0][0] == "running"


def test_capacity_and_concurrent_reservation(client, host):
    users = [owner(client) for _ in range(3)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        responses = list(pool.map(lambda headers: start(client, headers), users))
    assert sorted(r.status_code for r in responses) == [200, 200, 409]
    assert len(sql("SELECT id FROM managed_labs WHERE desired_state='running'")) == 2


def test_real_progress_binding_stop_revocation_and_history(client, host):
    user = owner(client)
    run = start(client, user).json()["run"]
    credentials = claim(client, host, run)
    headers = {"Authorization": "Bearer " + credentials["collector_token"]}
    payload = batch()
    assert client.post("/api/collector/batches", headers=headers, json=payload).status_code == 403
    payload.update(collector_id=run["collector_id"], flows=[])
    assert client.post("/api/collector/batches", headers=headers, json=payload).status_code == 200
    status = client.get("/api/workspace/lab", headers=user).json()["run"]
    assert (
        status["state"] == "awaiting_flows" and status["controller_seen_at"] and not status["first_flow_at"]
    )
    payload = batch()
    payload["collector_id"] = run["collector_id"]
    assert client.post("/api/collector/batches", headers=headers, json=payload).status_code == 200
    data = client.get("/api/snapshot", headers=user).json()
    assert data["workspace"]["lab"]["run"]["state"] == "running"
    assert data["summary"]["windows"] == 1 and data["collectors"][0]["source_type"] == "isolated_lab"
    assert client.get("/api/collector/other/commands", headers=headers).status_code == 403
    stop = client.post("/api/workspace/lab/stop", headers=user).json()["run"]
    assert stop["state"] == "stopping" and stop["cleanup_pending"]
    assert client.post("/api/collector/batches", headers=headers, json=payload).status_code == 401
    data = client.get("/api/snapshot", headers=user).json()
    assert not data["collectors"][0]["online"] and data["summary"]["windows"] == 1
    assert (
        client.post(
            f"/api/lab-host/runs/{run['id']}/report",
            headers=host,
            json={"revision": run["revision"], "event": "container_running"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/api/lab-host/runs/{run['id']}/report",
            headers=host,
            json={"revision": stop["revision"], "event": "stopped"},
        ).status_code
        == 200
    )
    assert client.get("/api/workspace/lab", headers=user).json()["run"]["stopped_at"]


def test_restart_is_fresh_and_old_credential_revoked(client, host):
    user = owner(client)
    run = start(client, user).json()["run"]
    key = claim(client, host, run)
    request_id = str(uuid4())
    restart = start(client, user, "restart", request_id).json()["run"]
    assert restart["id"] != run["id"]
    assert start(client, user, "restart", request_id).json()["run"]["id"] == restart["id"]
    assert len(sql("SELECT id FROM managed_labs")) == 2
    assert (
        client.get(
            f"/api/collector/{run['collector_id']}/commands",
            headers={"Authorization": "Bearer " + key["collector_token"]},
        ).status_code
        == 401
    )
    assert (
        client.post(f"/api/lab-host/runs/{run['id']}/claim", headers=host, json={"revision": 1}).status_code
        == 409
    )


@pytest.mark.parametrize("deadline", ["expires_at", "idle_expires_at"])
def test_expiry_revokes_before_daemon_cleanup(client, host, deadline):
    user = owner(client)
    run = start(client, user).json()["run"]
    key = claim(client, host, run)
    sql(f"UPDATE managed_labs SET {deadline}=now()-interval '1 second' WHERE id=%s", (run["id"],))
    assert (
        client.get(
            f"/api/collector/{run['collector_id']}/commands",
            headers={"Authorization": "Bearer " + key["collector_token"]},
        ).status_code
        == 401
    )
    assert not client.post("/api/workspace/lab/presence", headers=user, json={"lab_id": run["id"]}).json()[
        "active"
    ]
    client.post("/api/lab-host/poll", headers=host, json={"ready": True, "capacity": 2, "version": "test"})
    state = client.get("/api/workspace/lab", headers=user).json()["run"]
    assert state["state"] == "expired" and state["cleanup_pending"]
    response = client.post(
        f"/api/lab-host/runs/{run['id']}/report",
        headers=host,
        json={"revision": state["revision"], "event": "stopped"},
    )
    assert response.status_code == 200
    finished = client.get("/api/workspace/lab", headers=user).json()["run"]
    assert finished["state"] == "expired" and finished["stopped_at"]


def test_presence_is_scoped_and_bounded(client, host):
    user = owner(client)
    other = owner(client)
    run = start(client, user).json()["run"]
    assert not client.post("/api/workspace/lab/presence", headers=other, json={"lab_id": run["id"]}).json()[
        "active"
    ]
    assert client.post("/api/workspace/lab/presence", headers=user, json={"lab_id": run["id"]}).json()[
        "active"
    ]
    assert sql("SELECT idle_expires_at<=expires_at FROM managed_labs")[0][0]


def test_manual_and_managed_keys_coexist(client, host):
    user = owner(client)
    run = start(client, user).json()["run"]
    key = claim(client, host, run)
    assert client.post("/api/workspace/collector-setup", headers=user).status_code == 200
    assert client.post("/api/workspace/collector-key/revoke", headers=user).status_code == 200
    assert (
        client.get(
            f"/api/collector/{run['collector_id']}/commands",
            headers={"Authorization": "Bearer " + key["collector_token"]},
        ).status_code
        == 200
    )


def test_stale_host_start_timeout_and_throttle(client, host):
    user = owner(client)
    for _ in range(3):
        assert start(client, user).status_code == 200
        client.post("/api/workspace/lab/stop", headers=user)
    assert start(client, user).status_code == 429
    sql("UPDATE lab_hosts SET last_seen=now()-interval '1 minute'")
    assert start(client, owner(client)).status_code == 503


def test_start_timeout_and_global_external_capacity(client, host):
    user = owner(client)
    run = start(client, user).json()["run"]
    sql("UPDATE managed_labs SET created_at=now()-interval '4 minutes' WHERE id=%s", (run["id"],))
    client.post(
        "/api/lab-host/poll",
        headers=host,
        json={"ready": True, "capacity": 2, "external_busy": 2, "version": "test"},
    )
    failed = client.get("/api/workspace/lab", headers=user).json()["run"]
    assert failed["state"] == "failed"
    assert (
        client.post(
            f"/api/lab-host/runs/{run['id']}/report",
            headers=host,
            json={"revision": failed["revision"], "event": "stopped"},
        ).status_code
        == 200
    )
    assert client.get("/api/workspace/lab", headers=user).json()["run"]["state"] == "failed"
    assert start(client, owner(client)).status_code == 409
