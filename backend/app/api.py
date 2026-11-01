import asyncio
import csv
import io
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from psycopg.types.json import Jsonb

from app.config import settings
from app.db import db
from app.detector import detector
from app.managed_labs import lab_view
from app.schemas import ExplainRequest, IncidentUpdate, Login
from app.security import DUMMY_HASH, current_user, identity_user, digest, operator, public_user, verify

router = APIRouter(prefix="/api")


@router.post("/auth/login")
async def login(body: Login):
    identity = digest(body.email.strip().lower())
    # DB-backed lock and limiter survive replicas and restarts.
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (identity,))
        result = await conn.execute(
            "SELECT count(*) AS n FROM login_attempts WHERE identity=%s AND attempted_at>now()-interval '15 minutes'",
            (identity,),
        )
        if (await result.fetchone())["n"] >= 8:
            raise HTTPException(429, "Too many sign-in attempts. Try again in 15 minutes.")
        await conn.execute("INSERT INTO login_attempts(identity) VALUES (%s)", (identity,))
        result = await conn.execute("SELECT * FROM users WHERE email=%s", (body.email.strip().lower(),))
        user = await result.fetchone()
        valid = await asyncio.to_thread(
            verify, body.password, user["password_hash"] if user and user["password_enabled"] else DUMMY_HASH
        )
        if valid and user and user["active"] and user["password_enabled"]:
            token = secrets.token_urlsafe(48)
            expiry = datetime.now(timezone.utc) + timedelta(hours=settings().session_hours)
            await conn.execute(
                "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)",
                (digest(token), user["id"], expiry),
            )
            await db.audit(conn, user["id"], "auth.login", user["id"])
        else:
            # Commit the failed attempt before returning an auth error.
            token = None
    if not token:
        raise HTTPException(401, "Email or password is incorrect")
    return {"token": token, "expires_at": expiry, "user": public_user(user)}


@router.get("/auth/me")
async def me(user=Depends(identity_user)):
    return public_user(user)


@router.post("/auth/logout")
async def logout(user=Depends(identity_user)):
    await db.fetch("DELETE FROM sessions WHERE token_hash=%s", (user["token_hash"],))
    return {"ok": True}


@router.post("/auth/ws-ticket")
async def ws_ticket(user=Depends(current_user)):
    ticket = secrets.token_urlsafe(32)
    await db.fetch(
        "INSERT INTO ws_tickets(ticket_hash,session_hash,expires_at) VALUES (%s,%s,now()+interval '30 seconds')",
        (digest(ticket), user["token_hash"]),
    )
    return {"ticket": ticket}


async def snapshot(minutes: int = 15, *, workspace_id):
    async with db.connection() as conn:
        # One consistent database snapshot for counters, tables, and charts.
        await conn.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")

        async def fetch(query, params=()):
            cursor = await conn.execute(query, params)
            return await cursor.fetchall()

        summary = (
            await fetch(
                """SELECT count(*) AS windows,COALESCE(sum(packets),0) AS packets,
            COALESCE(sum(bytes),0) AS bytes,count(*) FILTER(WHERE prediction='attack') AS attack_windows,
            count(*) FILTER(WHERE prediction='unclassified') AS unclassified_windows,
            COALESCE(sum(bytes) FILTER(WHERE observed_at>now()-interval '60 seconds'),0)*(8.0/60) AS bits_per_second,
            COALESCE(sum(packets) FILTER(WHERE observed_at>now()-interval '60 seconds'),0)/60.0 AS packets_per_second,
            max(observed_at) AS last_flow FROM flows WHERE workspace_id=%s AND observed_at>now()-make_interval(mins=>%s)""",
                (workspace_id, minutes),
            )
        )[0]
        summary["open_incidents"] = (
            await fetch(
                "SELECT count(*) AS n FROM incidents WHERE workspace_id=%s AND status != 'resolved'",
                (workspace_id,),
            )
        )[0]["n"]
        collectors = await fetch(
            """SELECT c.*,c.last_seen>now()-interval '75 seconds' AND (c.lab_run_id IS NULL OR
            (l.desired_state='running' AND l.expires_at>now() AND l.idle_expires_at>now())) AS online
            FROM collectors c LEFT JOIN managed_labs l ON l.id=c.lab_run_id WHERE c.workspace_id=%s ORDER BY c.id""",
            (workspace_id,),
        )
        series = await fetch(
            """SELECT date_bin(interval '30 seconds',observed_at,'2020-01-01'::timestamptz) AS time,
            sum(bytes)*(8.0/30) AS bps,sum(packets)/30.0 AS pps,
            sum(CASE WHEN prediction='attack' THEN bytes ELSE 0 END)*(8.0/30) AS attack_bps
            FROM flows WHERE workspace_id=%s AND observed_at>now()-make_interval(mins=>%s) GROUP BY 1 ORDER BY 1""",
            (workspace_id, minutes),
        )
        flows = await fetch(
            "SELECT * FROM flows WHERE workspace_id=%s AND observed_at>now()-make_interval(mins=>%s) ORDER BY observed_at DESC,id DESC LIMIT 100",
            (workspace_id, minutes),
        )
        incidents = await fetch(
            "SELECT * FROM incidents WHERE workspace_id=%s ORDER BY last_seen DESC LIMIT 100", (workspace_id,)
        )
        commands = await fetch(
            """SELECT id,incident_id,kind,cookie,created_at,expires_at,detail,
            CASE WHEN status='enforced' AND expires_at<=now() THEN 'expired' ELSE status END AS status
            FROM commands WHERE workspace_id=%s ORDER BY created_at DESC LIMIT 100""",
            (workspace_id,),
        )
        protocols = await fetch(
            """SELECT protocol,sum(bytes) AS bytes,sum(packets) AS packets
            FROM flows WHERE workspace_id=%s AND observed_at>now()-make_interval(mins=>%s) GROUP BY protocol ORDER BY bytes DESC""",
            (workspace_id, minutes),
        )
        audit = await fetch(
            "SELECT * FROM audit_log WHERE workspace_id=%s ORDER BY id DESC LIMIT 30", (workspace_id,)
        )
        reports = await fetch(
            "SELECT id,incident_id,status,content,model,created_at FROM ai_reports WHERE workspace_id=%s ORDER BY created_at DESC LIMIT 30",
            (workspace_id,),
        )
        workspace = (
            await fetch("SELECT id,name,kind,created_at FROM workspaces WHERE id=%s", (workspace_id,))
        )[0]
        key = await fetch(
            "SELECT id,prefix,created_at,last_used_at FROM collector_credentials WHERE workspace_id=%s AND purpose='manual' AND revoked_at IS NULL",
            (workspace_id,),
        )
        workspace["collector_key"] = key[0] if key else None
        workspace["lab"] = await lab_view(conn, workspace_id)
        workspace["has_measurements"] = bool(
            (await fetch("SELECT 1 FROM flows WHERE workspace_id=%s LIMIT 1", (workspace_id,)))
        )
    return {
        "timestamp": datetime.now(timezone.utc),
        "window_minutes": minutes,
        "workspace": workspace,
        "summary": summary,
        "collectors": collectors,
        "series": series,
        "flows": flows,
        "incidents": incidents,
        "commands": commands,
        "protocols": protocols,
        "audit": audit,
        "reports": reports,
        "model": detector.status(),
        "integrations": {
            "database": True,
            "ai": bool(settings().openrouter_api_key),
            "mitigation": settings().mitigation_enabled,
        },
    }


@router.get("/snapshot")
async def get_snapshot(minutes: int = Query(default=15, ge=1, le=60), user=Depends(current_user)):
    return await snapshot(minutes, workspace_id=user["workspace_id"])


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: UUID, body: IncidentUpdate, user=Depends(operator)):
    async with db.connection() as conn:
        if body.assignee_id:
            target = await (
                await conn.execute(
                    "SELECT 1 FROM users WHERE id=%s AND workspace_id=%s AND active AND approved AND role IN ('admin','operator')",
                    (body.assignee_id, user["workspace_id"]),
                )
            ).fetchone()
            if not target:
                raise HTTPException(422, "Assign an active administrator or operator")
        cursor = await conn.execute(
            "UPDATE incidents SET status=%s,notes=%s,revision=revision+1,assignee_id=CASE WHEN %s THEN %s::uuid ELSE assignee_id END WHERE id=%s AND workspace_id=%s AND (%s::integer IS NULL OR revision=%s) RETURNING *",
            (
                body.status,
                body.notes,
                "assignee_id" in body.model_fields_set,
                body.assignee_id,
                incident_id,
                user["workspace_id"],
                body.revision,
                body.revision,
            ),
        )
        incident = await cursor.fetchone()
        if not incident:
            if await (
                await conn.execute(
                    "SELECT 1 FROM incidents WHERE id=%s AND workspace_id=%s",
                    (incident_id, user["workspace_id"]),
                )
            ).fetchone():
                raise HTTPException(
                    409, "Another operator updated this incident. Reopen it to review the latest notes."
                )
            raise HTTPException(404, "Incident not found")
        await db.audit(
            conn,
            user["id"],
            "incident.updated",
            incident_id,
            {
                "status": body.status,
                "notes": body.notes,
                "assignee_id": str(body.assignee_id) if body.assignee_id else None,
            },
        )
    return incident


@router.post("/incidents/{incident_id}/mitigate")
async def mitigate(incident_id: UUID, user=Depends(operator)):
    if not settings().mitigation_enabled:
        raise HTTPException(
            409, "Mitigation is disabled. Enable it on the backend and collector after model validation."
        )
    async with db.connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM incidents WHERE id=%s AND workspace_id=%s FOR UPDATE",
            (incident_id, user["workspace_id"]),
        )
        incident = await cursor.fetchone()
        if not incident:
            raise HTTPException(404, "Incident not found")
        if incident["status"] == "resolved":
            raise HTTPException(409, "Resolved incidents cannot be mitigated")
        cursor = await conn.execute(
            "SELECT online FROM (SELECT last_seen>now()-interval '75 seconds' AND controller_status='connected' AS online FROM collectors WHERE id=%s AND workspace_id=%s) c",
            (incident["collector_id"], user["workspace_id"]),
        )
        collector = await cursor.fetchone()
        if not collector or not collector["online"]:
            raise HTTPException(409, "Collector/controller is offline; no rule was requested")
        await conn.execute(
            "UPDATE commands SET status='expired' WHERE workspace_id=%s AND status='enforced' AND expires_at<=now()",
            (user["workspace_id"],),
        )
        cursor = await conn.execute(
            "SELECT id FROM commands WHERE incident_id=%s AND workspace_id=%s AND kind='block' AND status IN ('queued','dispatched','enforced')",
            (incident_id, user["workspace_id"]),
        )
        if await cursor.fetchone():
            raise HTTPException(409, "A block is already queued or enforced for this incident")
        command_id, cookie = uuid4(), secrets.randbits(60) | (0x5A << 52)
        payload = {
            "switch_id": incident["switch_id"],
            "source_ip": str(incident["source_ip"]),
            "destination_ip": str(incident["destination_ip"]),
            "protocol": incident["protocol"],
            "destination_port": incident["destination_port"],
            "hard_timeout": 300,
        }
        await conn.execute(
            """INSERT INTO commands(id,incident_id,collector_id,kind,status,cookie,payload,requested_by,workspace_id)
            VALUES (%s,%s,%s,'block','queued',%s,%s,%s,%s)""",
            (
                command_id,
                incident_id,
                incident["collector_id"],
                cookie,
                Jsonb(payload),
                user["id"],
                user["workspace_id"],
            ),
        )
        await db.audit(conn, user["id"], "mitigation.requested", command_id, payload)
    return {"id": command_id, "status": "queued", "detail": "Awaiting switch verification from collector"}


@router.post("/commands/{command_id}/revoke")
async def revoke(command_id: UUID, user=Depends(operator)):
    async with db.connection() as conn:
        cursor = await conn.execute(
            "SELECT * FROM commands WHERE id=%s AND workspace_id=%s FOR UPDATE",
            (command_id, user["workspace_id"]),
        )
        command = await cursor.fetchone()
        if not command or command["kind"] != "block":
            raise HTTPException(404, "Block command not found")
        if command["status"] != "enforced" or command["expires_at"] <= datetime.now(timezone.utc):
            raise HTTPException(409, "Only active enforced rules can be revoked")
        cursor = await conn.execute(
            "SELECT id FROM commands WHERE cookie=%s AND workspace_id=%s AND kind='unblock' AND status IN ('queued','dispatched')",
            (command["cookie"], user["workspace_id"]),
        )
        if await cursor.fetchone():
            raise HTTPException(409, "Revocation already requested")
        revoke_id = uuid4()
        await conn.execute(
            """INSERT INTO commands(id,incident_id,collector_id,kind,status,cookie,payload,requested_by,workspace_id)
            VALUES (%s,%s,%s,'unblock','queued',%s,%s,%s,%s)""",
            (
                revoke_id,
                command["incident_id"],
                command["collector_id"],
                command["cookie"],
                Jsonb(command["payload"]),
                user["id"],
                user["workspace_id"],
            ),
        )
        await db.audit(conn, user["id"], "mitigation.revoke_requested", revoke_id)
    return {"id": revoke_id, "status": "queued"}


@router.get("/flows/export")
async def export_flows(minutes: int = Query(default=15, ge=1, le=60), user=Depends(current_user)):
    rows = await db.fetch(
        """SELECT observed_at,collector_id,switch_id,source_ip,destination_ip,protocol,packets,bytes,
        packet_rate,byte_rate,prediction,attack_probability,model_version FROM flows
        WHERE workspace_id=%s AND observed_at>now()-make_interval(mins=>%s) ORDER BY observed_at DESC LIMIT 10000""",
        (user["workspace_id"], minutes),
    )
    output = io.StringIO()
    fields = [
        "observed_at",
        "collector_id",
        "switch_id",
        "source_ip",
        "destination_ip",
        "protocol",
        "packets",
        "bytes",
        "packet_rate",
        "byte_rate",
        "prediction",
        "attack_probability",
        "model_version",
    ]
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sentinel-flows.csv"},
    )


@router.post("/intelligence/explain")
async def explain(body: ExplainRequest, user=Depends(operator)):
    if not settings().openrouter_api_key:
        raise HTTPException(503, "Add OPENROUTER_API_KEY on the backend to enable incident analysis")
    incident = await db.one(
        "SELECT * FROM incidents WHERE id=%s AND workspace_id=%s", (body.incident_id, user["workspace_id"])
    )
    if not incident:
        raise HTTPException(404, "Incident not found")
    report_id = uuid4()
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(user["id"]),))
        cursor = await conn.execute(
            "SELECT count(*) AS n FROM ai_reports WHERE requested_by=%s AND created_at>now()-interval '1 minute'",
            (user["id"],),
        )
        if (await cursor.fetchone())["n"] >= 2:
            raise HTTPException(429, "Analysis is limited to two requests per minute")
        await conn.execute(
            "INSERT INTO ai_reports(id,incident_id,requested_by,status,model,workspace_id) VALUES (%s,%s,%s,'pending',%s,%s)",
            (report_id, body.incident_id, user["id"], settings().openrouter_model, user["workspace_id"]),
        )
    # Avoid transmitting IP addresses and user notes to an external model.
    evidence = {
        key: incident[key]
        for key in ("protocol", "probability", "packets", "bytes", "model_version", "status")
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings().openrouter_api_key}",
                    "X-Title": "Sentinel SDN",
                },
                json={
                    "model": settings().openrouter_model,
                    "max_tokens": 1500,
                    "reasoning": {"enabled": False},
                    "temperature": 0.2,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a defensive SDN analyst. Explain only supplied measured evidence. Distinguish model probability from certainty. Give concise verification and defensive response steps. No invented telemetry, no attack execution, no automatic actions. Plain text, under 250 words.",
                        },
                        {"role": "user", "content": str(evidence)},
                    ],
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise ValueError("Empty provider response")
    except (httpx.HTTPError, KeyError, ValueError, IndexError, TypeError):
        await db.fetch("UPDATE ai_reports SET status='failed' WHERE id=%s", (report_id,))
        raise HTTPException(
            502, "AI provider unavailable or quota exhausted. Detection remains operational."
        ) from None
    async with db.connection() as conn:
        await conn.execute(
            "UPDATE ai_reports SET status='complete',content=%s WHERE id=%s", (content, report_id)
        )
        await db.audit(conn, user["id"], "intelligence.generated", body.incident_id)
    return {"id": report_id, "content": content, "model": settings().openrouter_model}


@router.get("/intelligence/reports")
async def reports(user=Depends(current_user)):
    return await db.fetch(
        "SELECT id,incident_id,status,content,model,created_at FROM ai_reports WHERE workspace_id=%s ORDER BY created_at DESC LIMIT 30",
        (user["workspace_id"],),
    )
