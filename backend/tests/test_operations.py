"""Real PostgreSQL edge cases; no seeded application telemetry or external provider calls."""

from uuid import uuid4
import time
import psycopg
import pytest
from starlette.websockets import WebSocketDisconnect
from test_api import client as client
from test_api import auth, batch, TEST_URL, TOKEN


def test_account_permissions_uniqueness_and_last_admin(client):
    admin = auth(client)
    viewer = auth(client, "viewer")
    body = {
        "email": "operator@integration.test",
        "password": "A-private-operator-password!",
        "role": "operator",
    }
    assert client.post("/api/users", json=body, headers=viewer).status_code == 403
    created = client.post("/api/users", json=body, headers=admin)
    assert created.status_code == 201
    assert "password_hash" not in created.json()
    assert client.post("/api/users", json=body, headers=admin).status_code == 409
    users = client.get("/api/users", headers=admin).json()
    me = next(u for u in users if u["role"] == "admin")
    assert (
        client.patch(
            "/api/users/" + me["id"], json={"role": "viewer", "active": True}, headers=admin
        ).status_code
        == 409
    )
    assert (
        client.patch(
            "/api/users/" + me["id"], json={"role": "admin", "active": False}, headers=admin
        ).status_code
        == 409
    )
    op = client.post("/api/auth/login", json={"email": body["email"], "password": body["password"]}).json()[
        "token"
    ]
    assert client.post("/api/users", json=body, headers={"Authorization": "Bearer " + op}).status_code == 403
    assert (
        client.patch(
            "/api/users/" + created.json()["id"], json={"role": "operator", "active": False}, headers=admin
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + op}).status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": body["email"], "password": body["password"]}
        ).status_code
        == 401
    )


@pytest.mark.parametrize(
    "body",
    [
        {"email": "bad", "password": "Long-secret-password!", "role": "viewer"},
        {"email": "a@@example.com", "password": "Long-secret-password!", "role": "viewer"},
        {"email": "bad email@example.com", "password": "Long-secret-password!", "role": "viewer"},
        {"email": "new@example.com", "password": "short", "role": "viewer"},
        {"email": "new@example.com", "password": "Long-secret-password!", "role": "root"},
    ],
)
def test_account_input_validation(client, body):
    assert client.post("/api/users", json=body, headers=auth(client)).status_code == 422


def test_password_change_revokes_sessions_and_requires_old_password(client):
    headers = auth(client)
    assert (
        client.post(
            "/api/auth/password",
            headers=headers,
            json={"current_password": "wrong", "new_password": "New-private-password!"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/auth/password",
            headers=headers,
            json={"current_password": "Integration-test-password!", "new_password": "short"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/auth/password",
            headers=headers,
            json={"current_password": "Integration-test-password!", "new_password": "New-private-password!"},
        ).status_code
        == 200
    )
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "admin@integration.test", "password": "Integration-test-password!"},
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": "admin@integration.test", "password": "New-private-password!"}
        ).status_code
        == 200
    )


def test_history_keyset_literal_search_and_filters(client):
    machine = {"Authorization": "Bearer " + TOKEN}
    for _ in range(7):
        assert client.post("/api/collector/batches", json=batch(), headers=machine).status_code == 200
    headers = auth(client, "viewer")
    first = client.get("/api/flows?limit=3&search=10.1.0.1", headers=headers).json()
    second = client.get("/api/flows?limit=3&cursor=" + str(first["next_cursor"]), headers=headers).json()
    assert len(first["items"]) == 3 and len(second["items"]) == 3
    assert not (set(r["id"] for r in first["items"]) & set(r["id"] for r in second["items"]))
    assert client.get("/api/flows?search=%25", headers=headers).json()["items"] == []
    assert client.get("/api/flows?verdict=attack", headers=headers).json()["items"] == []
    assert client.get("/api/flows?limit=1000", headers=headers).status_code == 422
    assert client.get("/api/flows?cursor=-1", headers=headers).status_code == 422
    assert client.get("/api/flows").status_code == 401


def incident():
    identifier = uuid4()
    with psycopg.connect(TEST_URL) as c:
        c.execute(
            "INSERT INTO sentinel.incidents(id,collector_id,switch_id,source_ip,destination_ip,protocol,first_seen,last_seen,probability,packets,bytes,model_version) VALUES (%s,'test','1','10.1.0.1','10.1.0.2',6,now(),now(),.99,200,20000,'test-fixture-only')",
            (identifier,),
        )
    return str(identifier)


def test_concurrent_notes_cannot_silently_overwrite(client):
    item = incident()
    headers = auth(client)
    result = client.patch(
        "/api/incidents/" + item,
        headers=headers,
        json={"status": "acknowledged", "notes": "First operator evidence", "revision": 1},
    )
    assert result.status_code == 200 and result.json()["revision"] == 2
    conflict = client.patch(
        "/api/incidents/" + item,
        headers=headers,
        json={"status": "resolved", "notes": "Stale evidence", "revision": 1},
    )
    assert conflict.status_code == 409
    assert (
        next(i for i in client.get("/api/snapshot", headers=headers).json()["incidents"] if i["id"] == item)[
            "notes"
        ]
        == "First operator evidence"
    )


def test_live_commit_updates_shared_snapshot_and_ticket_validation(client):
    headers = auth(client)
    identifier = incident()

    def ticket():
        return client.post("/api/auth/ws-ticket", headers=headers).json()["ticket"]

    with client.websocket_connect(
        "/api/live?ticket=" + ticket(), headers={"origin": "http://localhost:5173"}
    ) as a:
        with client.websocket_connect(
            "/api/live?ticket=" + ticket(), headers={"origin": "http://localhost:5173"}
        ) as b:
            assert a.receive_json()["timestamp"] == b.receive_json()["timestamp"]
            started = time.monotonic()
            assert (
                client.patch(
                    "/api/incidents/" + identifier,
                    headers=headers,
                    json={"status": "resolved", "notes": "Shared evidence", "revision": 1},
                ).status_code
                == 200
            )
            for socket in [a, b]:
                for _ in range(4):
                    data = socket.receive_json()
                    if any(i["id"] == identifier and i["status"] == "resolved" for i in data["incidents"]):
                        break
                else:
                    raise AssertionError("Committed change not delivered")
            assert time.monotonic() - started < 3
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/live?ticket=" + ticket() + "&minutes=invalid", headers={"origin": "http://localhost:5173"}
        ):
            pass


def test_topology_validation_and_persistence(client):
    payload = batch()
    payload["topology"] = {
        "available": True,
        "links": [{"source": "1", "target": "2", "source_port": 1, "target_port": 2}],
        "hosts": [{"mac": "00:00:00:00:00:01", "addresses": ["10.1.0.1"], "switch_id": "1", "port": 3}],
        "ports": [],
    }
    assert (
        client.post(
            "/api/collector/batches", headers={"Authorization": "Bearer " + TOKEN}, json=payload
        ).status_code
        == 200
    )
    data = client.get("/api/snapshot", headers=auth(client)).json()
    assert data["collectors"][0]["topology"]["hosts"][0]["addresses"] == ["10.1.0.1"]
    payload["topology"]["hosts"][0]["mac"] = "invalid"
    assert (
        client.post(
            "/api/collector/batches", headers={"Authorization": "Bearer " + TOKEN}, json=payload
        ).status_code
        == 422
    )


def test_ownership_and_viewer_mutation_are_enforced(client):
    item = incident()
    headers = auth(client)
    users = client.get("/api/users", headers=headers).json()
    owner = next(u for u in users if u["role"] == "admin")
    viewer = next(u for u in users if u["role"] == "viewer")
    assert (
        client.patch(
            "/api/incidents/" + item,
            headers=auth(client, "viewer"),
            json={"status": "acknowledged", "notes": "", "revision": 1},
        ).status_code
        == 403
    )
    assert (
        client.patch(
            "/api/incidents/" + item,
            headers=headers,
            json={"status": "acknowledged", "notes": "", "revision": 1, "assignee_id": viewer["id"]},
        ).status_code
        == 422
    )
    result = client.patch(
        "/api/incidents/" + item,
        headers=headers,
        json={"status": "acknowledged", "notes": "Assigned", "revision": 1, "assignee_id": owner["id"]},
    )
    assert result.status_code == 200 and result.json()["assignee_id"] == owner["id"]
    assert (
        client.patch(
            "/api/incidents/" + item,
            headers=headers,
            json={"status": "acknowledged", "notes": "Unassigned", "revision": 2, "assignee_id": None},
        ).json()["assignee_id"]
        is None
    )


def test_body_limit_and_disallowed_websocket_origin(client):
    assert (
        client.post(
            "/api/auth/login", content=b"x" * 2000001, headers={"content-type": "application/json"}
        ).status_code
        == 413
    )
    headers = auth(client)
    ticket = client.post("/api/auth/ws-ticket", headers=headers).json()["ticket"]
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/api/live?ticket=" + ticket, headers={"origin": "https://untrusted.example"}
        ):
            pass
