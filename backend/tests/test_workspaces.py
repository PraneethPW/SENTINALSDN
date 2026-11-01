"""Tenant boundaries against PostgreSQL. Test-only counters never enter application databases."""

import io
from zipfile import ZipFile
from uuid import uuid4

import psycopg
from test_api import client as client, auth, batch, TEST_URL, TOKEN


def owner(client, address="owner@integration.test"):
    r = client.post(
        "/api/auth/register",
        json={
            "display_name": "Network Owner",
            "email": address,
            "password": "Private-workspace-password!",
            "workspace_id": "00000000-0000-0000-0000-000000000001",
        },
    )
    assert r.status_code == 201, r.text
    data = r.json()
    return {"Authorization": "Bearer " + data["token"]}, data["user"]


def setup(client, headers):
    r = client.post("/api/workspace/collector-setup", headers=headers)
    assert r.status_code == 200, r.text
    with ZipFile(io.BytesIO(r.content)) as z:
        assert "sentinel-network/collector/agent.py" in z.namelist()
        assert "sentinel-network/lab/network.py" in z.namelist()
        assert "sentinel-network/connect.py" in z.namelist()
        wid = client.get("/api/workspace", headers=headers).json()["id"]
        assert z.read("sentinel-network/compose.yml").decode().splitlines()[
            0
        ] == "name: sentinel-network-" + wid.replace("-", "")
        assert "DATABASE_URL" not in z.read("sentinel-network/.env").decode()
        env = dict(line.split("=", 1) for line in z.read("sentinel-network/.env").decode().splitlines())
    return {"Authorization": "Bearer " + env["COLLECTOR_TOKEN"]}, env["COLLECTOR_TOKEN"]


def test_new_owner_empty_then_scoped_collector_live_history_export_and_persistence(client):
    legacy = auth(client)
    payload = batch()
    assert (
        client.post(
            "/api/collector/batches", json=payload, headers={"Authorization": "Bearer " + TOKEN}
        ).status_code
        == 200
    )
    mine, identity = owner(client)
    initial = client.get("/api/snapshot", headers=mine).json()
    assert initial["workspace"]["id"] == identity["workspace_id"]
    assert initial["summary"]["windows"] == 0 and initial["collectors"] == []
    assert initial["incidents"] == initial["reports"] == initial["commands"] == []
    assert all(a["actor"] == identity["id"] for a in initial["audit"])
    machine, token = setup(client, mine)
    assert client.get("/api/snapshot", headers=machine).status_code == 401
    assert client.post("/api/collector/batches", json=payload, headers=machine).status_code == 409
    payload["batch_id"] = str(uuid4())
    payload["flows"][0]["packets"] = 300
    assert client.post("/api/collector/batches", json=payload, headers=machine).json()["accepted"] == 1
    assert client.post("/api/collector/batches", json=payload, headers=machine).json()["duplicate"] is True
    current = client.get("/api/snapshot", headers=mine).json()
    assert current["summary"]["packets"] == 300 and current["workspace"]["has_measurements"] is True
    assert current["collectors"][0]["id"] == payload["collector_id"]
    assert client.get("/api/snapshot", headers=legacy).json()["summary"]["packets"] == 200
    assert len(client.get("/api/flows", headers=mine).json()["items"]) == 1
    exported = client.get("/api/flows/export", headers=mine)
    assert len(exported.text.strip().splitlines()) == 2 and ",300," in exported.text
    assert token not in client.get("/api/workspace", headers=mine).text
    with psycopg.connect(TEST_URL) as c:
        assert (
            c.execute(
                "SELECT token_hash FROM sentinel.collector_credentials WHERE workspace_id=%s",
                (identity["workspace_id"],),
            ).fetchone()[0]
            != token
        )
    assert client.post("/api/workspace/collector-setup", headers=mine).status_code == 409
    client.post("/api/auth/logout", headers=mine)
    signed = client.post(
        "/api/auth/login", json={"email": identity["email"], "password": "Private-workspace-password!"}
    ).json()
    assert signed["user"]["workspace_id"] == identity["workspace_id"]
    assert (
        client.get("/api/snapshot", headers={"Authorization": "Bearer " + signed["token"]}).json()["summary"][
            "packets"
        ]
        == 300
    )


def test_foreign_incidents_commands_assignments_members_and_reports_are_inaccessible(client, monkeypatch):
    from app.config import settings

    mine, identity = owner(client)
    other, outsider = owner(client, "outsider@integration.test")
    iid, cid, rid = uuid4(), uuid4(), uuid4()
    with psycopg.connect(TEST_URL) as c:
        c.execute(
            "INSERT INTO sentinel.incidents(id,collector_id,switch_id,source_ip,destination_ip,protocol,first_seen,last_seen,probability,packets,bytes,model_version,workspace_id) VALUES (%s,'same-name','1','10.1.0.1','10.1.0.2',6,now(),now(),.99,200,20000,'test-only',%s)",
            (iid, identity["workspace_id"]),
        )
        c.execute(
            "INSERT INTO sentinel.commands(id,incident_id,collector_id,kind,status,cookie,payload,requested_by,workspace_id) VALUES (%s,%s,'same-name','block','enforced',12,'{}',%s,%s)",
            (cid, iid, identity["id"], identity["workspace_id"]),
        )
        c.execute(
            "INSERT INTO sentinel.ai_reports(id,incident_id,requested_by,status,model,content,workspace_id) VALUES (%s,%s,%s,'complete','test-only','Private report evidence',%s)",
            (rid, iid, identity["id"], identity["workspace_id"]),
        )
    snapshot = client.get("/api/snapshot", headers=other).json()
    assert snapshot["incidents"] == snapshot["commands"] == snapshot["reports"] == []
    assert client.get("/api/intelligence/reports", headers=other).json() == []
    assert (
        client.patch(
            f"/api/incidents/{iid}", headers=other, json={"status": "resolved", "notes": "intrusion"}
        ).status_code
        == 404
    )
    assert client.post(f"/api/incidents/{iid}/mitigate", headers=other).status_code == 404
    assert client.post(f"/api/commands/{cid}/revoke", headers=other).status_code == 404
    assert (
        client.patch(
            f"/api/incidents/{iid}",
            headers=mine,
            json={"status": "acknowledged", "assignee_id": outsider["id"]},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/users/{identity['id']}", headers=other, json={"role": "viewer", "active": False}
        ).status_code
        == 404
    )
    monkeypatch.setenv("OPENROUTER_API_KEY", "isolated-provider-not-called")
    settings.cache_clear()
    assert (
        client.post("/api/intelligence/explain", headers=other, json={"incident_id": str(iid)}).status_code
        == 404
    )
    foreign_machine, _ = setup(client, other)
    assert client.get("/api/collector/same-name/commands", headers=foreign_machine).json() == []
    assert (
        client.post(
            f"/api/collector/same-name/commands/{cid}/result",
            headers=foreign_machine,
            json={"status": "enforced", "detail": "unauthorized"},
        ).status_code
        == 404
    )


def test_live_snapshot_cache_and_reconnect_are_workspace_scoped(client):
    left, _ = owner(client)
    right, _ = owner(client, "right@integration.test")
    machine, _ = setup(client, left)
    client.post("/api/collector/batches", headers=machine, json=batch()).raise_for_status()

    def ticket(h):
        return client.post("/api/auth/ws-ticket", headers=h).json()["ticket"]

    with client.websocket_connect(
        "/api/live?ticket=" + ticket(left), headers={"origin": "http://localhost:5173"}
    ) as a:
        with client.websocket_connect(
            "/api/live?ticket=" + ticket(right), headers={"origin": "http://localhost:5173"}
        ) as b:
            assert a.receive_json()["summary"]["windows"] == 1
            empty = b.receive_json()
            assert empty["summary"]["windows"] == 0 and empty["collectors"] == []
    with client.websocket_connect(
        "/api/live?ticket=" + ticket(right), headers={"origin": "http://localhost:5173"}
    ) as c:
        assert c.receive_json()["flows"] == []


def test_credential_revocation_and_roles_do_not_affect_other_workspaces(client):
    mine, identity = owner(client)
    other, _ = owner(client, "other@integration.test")
    key, _ = setup(client, mine)
    other_key, _ = setup(client, other)
    member = {"email": "member@integration.test", "password": "Workspace-member-password!", "role": "viewer"}
    assert client.post("/api/users", headers=mine, json=member).status_code == 201
    signed = client.post(
        "/api/auth/login", json={"email": member["email"], "password": member["password"]}
    ).json()
    assert signed["user"]["workspace_id"] == identity["workspace_id"]
    viewer = {"Authorization": "Bearer " + signed["token"]}
    assert client.post("/api/workspace/collector-setup", headers=viewer).status_code == 403
    assert client.post("/api/workspace/collector-key/revoke", headers=viewer).status_code == 403
    assert client.patch("/api/workspace", headers=viewer, json={"name": "Changed"}).status_code == 403
    assert (
        client.patch("/api/workspace", headers=mine, json={"name": "Production network"}).json()["name"]
        == "Production network"
    )
    assert client.get("/api/workspace", headers=other).json()["name"] != "Production network"
    assert client.post("/api/workspace/collector-key/revoke", headers=mine).json()["revoked"] is True
    assert client.post("/api/collector/batches", headers=key, json=batch()).status_code == 401
    assert client.post("/api/collector/batches", headers=other_key, json=batch()).status_code == 200
    assert client.post("/api/workspace/collector-setup", headers=mine).status_code == 200


def test_old_public_pending_registration_moves_without_unlocking_a_revoked_team_member(client):
    from pathlib import Path
    from app.security import passwords

    pending, revoked, promoted = uuid4(), uuid4(), uuid4()
    with psycopg.connect(TEST_URL) as c:
        for uid, address in [
            (pending, "pending@integration.test"),
            (revoked, "revoked@integration.test"),
            (promoted, "promoted@integration.test"),
        ]:
            c.execute(
                "INSERT INTO sentinel.users(id,email,password_hash,role,approved) VALUES (%s,%s,%s,'viewer',false)",
                (uid, address, passwords.hash("Private-test-password!")),
            )
            c.execute(
                "INSERT INTO sentinel.audit_log(actor,action,resource,detail) VALUES (%s,'account.registered',%s,'{\"approval\":\"pending\"}')",
                (str(uid), str(uid)),
            )
        c.execute(
            "INSERT INTO sentinel.audit_log(actor,action,resource,detail) VALUES ('admin','user.updated',%s,'{\"approved\":false}')",
            (str(revoked),),
        )
        c.execute("UPDATE sentinel.users SET role='admin' WHERE id=%s", (promoted,))
        c.execute(
            "INSERT INTO sentinel.audit_log(actor,action,resource,detail) VALUES ('admin','user.updated',%s,'{\"role\":\"admin\",\"approved\":null}')",
            (str(promoted),),
        )
        migration = Path("app/migrations/005_workspaces.sql").read_text()
        backfill = migration[
            migration.index("DO $$ DECLARE account") : migration.index(
                "INSERT INTO schema_versions(version) VALUES (5)"
            )
        ]
        c.execute("SET LOCAL search_path TO sentinel")
        c.execute(backfill)
        rows = dict(
            (str(r[0]), r[1:])
            for r in c.execute(
                "SELECT id,workspace_id,role,approved FROM sentinel.users WHERE id IN (%s,%s,%s)",
                (pending, revoked, promoted),
            ).fetchall()
        )
        assert str(rows[str(pending)][0]) != "00000000-0000-0000-0000-000000000001"
        assert rows[str(pending)][1:] == ("admin", True)
        assert rows[str(revoked)][1:] == ("viewer", False)
        assert str(rows[str(promoted)][0]) != "00000000-0000-0000-0000-000000000001"
        assert rows[str(promoted)][1:] == ("admin", True)
