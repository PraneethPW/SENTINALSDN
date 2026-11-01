"""Durable, workspace-scoped lab lifecycle. The private host reconciles desired state."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.db import db
from app.operations import administrator
from app.security import bearer, current_user, digest

router = APIRouter(prefix="/api")
LOCK = 739142030


def lab_token(lab_id):
    message = f"managed-lab:{settings().environment}:{lab_id}".encode()
    return "snl_" + hmac.new(settings().lab_host_token.encode(), message, hashlib.sha256).hexdigest()


async def host_auth(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    secret = settings().lab_host_token
    if (
        not secret
        or not credentials
        or not secrets.compare_digest(digest(credentials.credentials), digest(secret))
    ):
        raise HTTPException(401, "Invalid lab host credentials")
    return settings().lab_host_id


async def expire_runs(conn):
    expired = await (
        await conn.execute(
            """UPDATE managed_labs SET desired_state='stopped',state=CASE WHEN expires_at<=now() OR idle_expires_at<=now() THEN 'expired' ELSE 'failed' END,
        revision=revision+1,updated_at=now(),message=CASE WHEN expires_at<=now() THEN 'Session time limit reached.'
        WHEN idle_expires_at<=now() THEN 'Stopped after the console was closed or hidden.' ELSE 'The network did not become ready in time. Please try again.' END
        WHERE desired_state='running' AND (expires_at<=now() OR idle_expires_at<=now() OR
        (first_flow_at IS NULL AND created_at<now()-make_interval(secs=>%s))) RETURNING id""",
            (settings().lab_start_timeout_seconds,),
        )
    ).fetchall()
    if expired:
        await conn.execute(
            "UPDATE collector_credentials SET revoked_at=now() WHERE lab_run_id=ANY(%s) AND revoked_at IS NULL",
            ([r["id"] for r in expired],),
        )


async def lab_view(conn, workspace_id):
    now = datetime.now(timezone.utc)
    host = await (
        await conn.execute("SELECT * FROM lab_hosts WHERE id=%s", (settings().lab_host_id,))
    ).fetchone()
    online = bool(host and host["last_seen"] > now - timedelta(seconds=35))
    ready = bool(online and host["ready"] and settings().lab_host_token)
    reservations = (
        await (
            await conn.execute(
                "SELECT count(DISTINCT workspace_id) AS n FROM managed_labs WHERE host_id=%s AND stopped_at IS NULL",
                (settings().lab_host_id,),
            )
        ).fetchone()
    )["n"]
    mine = await (
        await conn.execute(
            "SELECT * FROM managed_labs WHERE workspace_id=%s ORDER BY created_at DESC,id DESC LIMIT 1",
            (workspace_id,),
        )
    ).fetchone()
    capacity = min(host["capacity"], settings().lab_capacity) if host else settings().lab_capacity
    free = max(0, capacity - reservations - (host["external_busy"] if host else 0))
    owns_slot = bool(mine and mine["stopped_at"] is None)
    public = None
    if mine:
        fields = (
            "id",
            "collector_id",
            "desired_state",
            "state",
            "revision",
            "message",
            "created_at",
            "updated_at",
            "expires_at",
            "idle_expires_at",
            "started_at",
            "controller_seen_at",
            "first_flow_at",
            "stopped_at",
        )
        public = {key: mine[key] for key in fields}
        if mine["desired_state"] == "running" and min(mine["expires_at"], mine["idle_expires_at"]) <= now:
            public.update(state="expired", message="Session ended. Network cleanup is pending.")
        public["cleanup_pending"] = mine["desired_state"] == "stopped" and mine["stopped_at"] is None
    return {
        "run": public,
        "host": {
            "enabled": bool(settings().lab_host_token),
            "online": online,
            "ready": ready,
            "capacity": capacity,
            "available_slots": free,
            "can_start": ready and (free > 0 or owns_slot),
            "reason": host["reason"] if online else "offline",
        },
        "limits": {
            "session_minutes": settings().lab_session_minutes,
            "idle_minutes": settings().lab_idle_minutes,
        },
    }


class LabIntent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID = Field(default_factory=uuid4)


async def stop_run(
    conn, row, actor, reason="Stop requested. Uploads are disabled while the host cleans up your network."
):
    await conn.execute(
        "UPDATE managed_labs SET desired_state='stopped',state='stopping',message=%s,revision=revision+1,updated_at=now() WHERE id=%s",
        (reason, row["id"]),
    )
    await conn.execute(
        "UPDATE collector_credentials SET revoked_at=now() WHERE lab_run_id=%s AND revoked_at IS NULL",
        (row["id"],),
    )
    await db.audit(conn, actor, "lab.stop_requested", row["id"], workspace_id=row["workspace_id"])


async def request_start(body, user, restart=False):
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
        await expire_runs(conn)
        previous = await (
            await conn.execute(
                "SELECT id FROM managed_labs WHERE workspace_id=%s AND request_id=%s",
                (user["workspace_id"], body.request_id),
            )
        ).fetchone()
        if previous:
            return await lab_view(conn, user["workspace_id"])
        active = await (
            await conn.execute(
                "SELECT * FROM managed_labs WHERE workspace_id=%s AND desired_state='running' FOR UPDATE",
                (user["workspace_id"],),
            )
        ).fetchone()
        if active and not restart:
            return await lab_view(conn, user["workspace_id"])
        view = await lab_view(conn, user["workspace_id"])
        if not view["host"]["ready"]:
            raise HTTPException(503, "The live lab host is unavailable. Please try when it is online.")
        if not view["host"]["can_start"]:
            raise HTTPException(
                409, "All live lab slots are in use. Please try again when a slot is available."
            )
        count = (
            await (
                await conn.execute(
                    "SELECT count(*) AS n FROM managed_labs WHERE workspace_id=%s AND created_at>now()-interval '1 minute'",
                    (user["workspace_id"],),
                )
            ).fetchone()
        )["n"]
        if count >= 3:
            raise HTTPException(429, "Please wait a minute before starting another lab.")
        if active:
            await stop_run(conn, active, user["id"], "Restart requested. Previous measurements are retained.")
        run_id = uuid4()
        token = lab_token(run_id)
        await conn.execute(
            """INSERT INTO managed_labs(id,workspace_id,host_id,requested_by,request_id,collector_id,desired_state,state,expires_at,idle_expires_at)
        VALUES (%s,%s,%s,%s,%s,%s,'running','queued',now()+make_interval(mins=>%s),now()+make_interval(mins=>%s))""",
            (
                run_id,
                user["workspace_id"],
                settings().lab_host_id,
                user["id"],
                body.request_id,
                "lab-" + run_id.hex,
                settings().lab_session_minutes,
                min(settings().lab_idle_minutes, settings().lab_session_minutes),
            ),
        )
        await conn.execute(
            """INSERT INTO collector_credentials(id,workspace_id,token_hash,prefix,created_by,purpose,lab_run_id,expires_at)
        SELECT %s,workspace_id,%s,%s,%s,'managed_lab',id,expires_at FROM managed_labs WHERE id=%s""",
            (uuid4(), digest(token), token[:12], user["id"], run_id),
        )
        await db.audit(conn, user["id"], "lab.start_requested", run_id, workspace_id=user["workspace_id"])
        return await lab_view(conn, user["workspace_id"])


@router.get("/workspace/lab")
async def get_lab(user=Depends(current_user)):
    async with db.connection() as conn:
        return await lab_view(conn, user["workspace_id"])


@router.post("/workspace/lab/start")
async def start(body: LabIntent, user=Depends(administrator)):
    return await request_start(body, user)


@router.post("/workspace/lab/restart")
async def restart(body: LabIntent, user=Depends(administrator)):
    return await request_start(body, user, True)


@router.post("/workspace/lab/stop")
async def stop(user=Depends(administrator)):
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
        row = await (
            await conn.execute(
                "SELECT * FROM managed_labs WHERE workspace_id=%s AND desired_state='running' FOR UPDATE",
                (user["workspace_id"],),
            )
        ).fetchone()
        if row:
            await stop_run(conn, row, user["id"])
        return await lab_view(conn, user["workspace_id"])


class Presence(BaseModel):
    lab_id: UUID


@router.post("/workspace/lab/presence")
async def presence(body: Presence, user=Depends(current_user)):
    rows = await db.fetch(
        """UPDATE managed_labs SET idle_expires_at=LEAST(expires_at,now()+make_interval(mins=>%s))
    WHERE id=%s AND workspace_id=%s AND desired_state='running' AND expires_at>now() AND idle_expires_at>now() RETURNING id""",
        (settings().lab_idle_minutes, body.lab_id, user["workspace_id"]),
    )
    return {"active": bool(rows)}


class HostPoll(BaseModel):
    ready: bool
    capacity: int = Field(ge=1, le=8)
    external_busy: int = Field(default=0, ge=0, le=32)
    reason: Literal["ready", "preparing", "docker_unavailable", "host_error"] = "ready"
    version: str = Field(max_length=32)


@router.post("/lab-host/poll")
async def poll(body: HostPoll, host=Depends(host_auth)):
    async with db.connection() as conn:
        await conn.execute(
            """INSERT INTO lab_hosts(id,last_seen,ready,capacity,external_busy,reason,version) VALUES (%s,now(),%s,%s,%s,%s,%s)
        ON CONFLICT(id) DO UPDATE SET last_seen=now(),ready=EXCLUDED.ready,capacity=EXCLUDED.capacity,external_busy=EXCLUDED.external_busy,reason=EXCLUDED.reason,version=EXCLUDED.version""",
            (
                host,
                body.ready,
                min(body.capacity, settings().lab_capacity),
                body.external_busy,
                body.reason,
                body.version,
            ),
        )
        await expire_runs(conn)
        jobs = await (
            await conn.execute(
                "SELECT id,workspace_id,collector_id,desired_state,state,revision,expires_at,started_at FROM managed_labs WHERE host_id=%s AND stopped_at IS NULL ORDER BY created_at",
                (host,),
            )
        ).fetchall()
    return {"jobs": jobs}


class Revision(BaseModel):
    revision: int = Field(ge=1)


@router.post("/lab-host/runs/{run_id}/claim")
async def claim(run_id: UUID, body: Revision, host=Depends(host_auth)):
    async with db.connection() as conn:
        row = await (
            await conn.execute(
                """UPDATE managed_labs SET state=CASE WHEN state='queued' THEN 'starting' ELSE state END,updated_at=now()
        WHERE id=%s AND host_id=%s AND desired_state='running' AND revision=%s AND expires_at>now() AND idle_expires_at>now() RETURNING *""",
                (run_id, host, body.revision),
            )
        ).fetchone()
        if not row:
            raise HTTPException(409, "This lab request changed or expired")
        key = await (
            await conn.execute(
                "SELECT token_hash FROM collector_credentials WHERE lab_run_id=%s AND revoked_at IS NULL AND expires_at>now()",
                (run_id,),
            )
        ).fetchone()
        token = lab_token(run_id)
        if not key or not secrets.compare_digest(key["token_hash"], digest(token)):
            raise HTTPException(409, "The lab credential was revoked; restart the lab")
        return {
            "collector_token": token,
            "collector_id": row["collector_id"],
            "workspace_id": row["workspace_id"],
            "expires_at": row["expires_at"],
            "revision": row["revision"],
        }


class HostReport(Revision):
    event: Literal["container_running", "stopped", "failed", "waiting_capacity"]
    reason: Literal["ready", "user_stop", "expired", "start_failed", "container_exited", "capacity"] = "ready"


@router.post("/lab-host/runs/{run_id}/report")
async def report(run_id: UUID, body: HostReport, host=Depends(host_auth)):
    async with db.connection() as conn:
        row = await (
            await conn.execute(
                "SELECT * FROM managed_labs WHERE id=%s AND host_id=%s FOR UPDATE", (run_id, host)
            )
        ).fetchone()
        if not row:
            raise HTTPException(404, "Lab not found")
        if row["revision"] != body.revision:
            raise HTTPException(409, "Lab request changed; reconcile again")
        if body.event == "container_running":
            if row["desired_state"] != "running":
                raise HTTPException(409, "Stop this lab")
            await conn.execute(
                "UPDATE managed_labs SET state=CASE WHEN state IN ('queued','starting') THEN 'awaiting_controller' ELSE state END,started_at=COALESCE(started_at,now()),message='',updated_at=now() WHERE id=%s",
                (run_id,),
            )
        elif body.event == "waiting_capacity":
            if row["desired_state"] == "running":
                await conn.execute(
                    "UPDATE managed_labs SET message='Waiting for a free lab slot.',updated_at=now() WHERE id=%s",
                    (run_id,),
                )
        else:
            state = "stopped" if body.event == "stopped" and row["desired_state"] == "stopped" else "failed"
            if row["state"] in ("expired", "failed"):
                state = row["state"]
            message = (
                row["message"]
                if row["desired_state"] == "stopped"
                else "The lab process stopped unexpectedly. Please start a new session."
            )
            if state == "stopped":
                message = "Network stopped. Your measurements are retained."
            await conn.execute(
                "UPDATE managed_labs SET desired_state='stopped',state=%s,stopped_at=now(),updated_at=now(),message=%s WHERE id=%s",
                (state, message, run_id),
            )
            await conn.execute(
                "UPDATE collector_credentials SET revoked_at=now() WHERE lab_run_id=%s AND revoked_at IS NULL",
                (run_id,),
            )
            await db.audit(conn, "lab-host", "lab." + state, run_id, workspace_id=row["workspace_id"])
    return {"ok": True}


@router.post("/lab-host/drain")
async def drain(host=Depends(host_auth)):
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK,))
        rows = await (
            await conn.execute(
                "SELECT * FROM managed_labs WHERE host_id=%s AND desired_state='running' FOR UPDATE", (host,)
            )
        ).fetchall()
        for row in rows:
            await stop_run(conn, row, "lab-host", "Lab host is shutting down.")
    return {"stopping": len(rows)}
