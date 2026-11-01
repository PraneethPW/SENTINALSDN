"""Self-service network onboarding. No telemetry is created by these endpoints."""

import io
import secrets
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4
from zipfile import ZipFile, ZIP_DEFLATED

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.db import db
from app.operations import administrator
from app.security import current_user, digest

router = APIRouter(prefix="/api/workspace")


class WorkspaceName(BaseModel):
    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def clean(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError("Use a workspace name of 2–80 characters")
        return value


@router.get("")
async def workspace(user=Depends(current_user)):
    row = await db.one("SELECT id,name,kind,created_at FROM workspaces WHERE id=%s", (user["workspace_id"],))
    row["collector_key"] = await db.one(
        "SELECT id,prefix,created_at,last_used_at FROM collector_credentials WHERE workspace_id=%s AND revoked_at IS NULL",
        (user["workspace_id"],),
    )
    return row


@router.patch("")
async def rename(body: WorkspaceName, user=Depends(administrator)):
    async with db.connection() as conn:
        row = await (
            await conn.execute(
                "UPDATE workspaces SET name=%s WHERE id=%s RETURNING id,name,kind,created_at",
                (body.name, user["workspace_id"]),
            )
        ).fetchone()
        await db.audit(conn, user["id"], "workspace.renamed", user["workspace_id"], {"name": body.name})
    return row


def collector_bundle(api_url: str, token: str, workspace_id) -> bytes:
    root = Path(__file__).resolve().parent.parent
    output = io.BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.write(root / "collector/connect.py", "sentinel-network/connect.py")
        for filename in (
            "collector/__init__.py",
            "collector/agent.py",
            "collector/sentinel_switch.py",
            "lab/Dockerfile",
            "lab/start.sh",
            "lab/network.py",
        ):
            archive.write(root / filename, "sentinel-network/" + filename)
        archive.writestr(
            "sentinel-network/.env",
            f"SENTINEL_API_URL={api_url}\nCOLLECTOR_TOKEN={token}\nCOLLECTOR_ID=my-network\nPOLL_SECONDS=30\nALLOW_MITIGATION=false\n",
        )
        archive.writestr("sentinel-network/.gitignore", ".env\n.spool/\n")
        archive.writestr("sentinel-network/.dockerignore", ".env\n.spool/\n.git/\n")
        archive.writestr(
            "sentinel-network/compose.yml",
            "name: sentinel-network-"
            + UUID(str(workspace_id)).hex
            + "\n"
            + """\
services:
  lab:
    build:
      context: .
      dockerfile: lab/Dockerfile
    privileged: true
    restart: unless-stopped
    env_file: .env
    environment:
      SPOOL_DIRECTORY: /var/lib/sentinel/spool
    extra_hosts:
      - host.docker.internal:host-gateway
    volumes:
      - spool:/var/lib/sentinel/spool
volumes:
  spool:
""",
        )
        archive.writestr(
            "sentinel-network/README.md",
            """# Connect your private Sentinel workspace

This bundle contains a PRIVATE collector key in `.env`. Keep the folder private;
do not commit or share it. The key is scoped to your workspace. You can revoke it
from Network setup. It cannot sign in as a user or read another workspace.

## Option A — real isolated research lab

Requires Docker with Linux containers (Docker Desktop on Mac/Windows or Docker
Engine on Linux). This runs Mininet, Open vSwitch, an OS-Ken controller, and a
collector in a privileged container. It creates three switches and three hosts
with bounded ICMP and 64 Kbit/s UDP traffic. It does not capture your Mac's normal
traffic and does not attack an external target. No port is exposed to the host.

1. Open a terminal in this extracted `sentinel-network` folder.
2. Ensure your Docker Linux engine or Colima VM is running.
3. `python3 connect.py up` (first build downloads official dependencies).
   The helper detects a running Docker context and either Compose command. It
   does not change your global Docker settings. Every workspace has a unique
   Compose project and spool volume, so it cannot reuse another workspace's lab.
4. Return to Sentinel → Network setup. Watch collector, controller, and flow status.
   Allow about 60–90 seconds after the container starts for the first counter window.
5. `python3 connect.py status` checks the container; `python3 connect.py logs`
   shows the actual collector log. Use `--context NAME` to select a specific engine.
6. Stop this lab with `python3 connect.py down`. Keep the Mac awake to keep telemetry live.
   On Windows, use `python` if your installation has no `python3` command.
   You may also use ordinary Docker Compose commands with your intended context
   and this compose.yml; the helper supports standalone docker-compose on Macs.

## Option B — your existing SDN controller

Run the collector beside a trusted Ryu/OS-Ken OpenFlow 1.3 controller exposing the
`/stats` REST interface. Included `collector/sentinel_switch.py` provides exact IPv4
flow rules and discovery. It is for an isolated lab; review before using it on a
production network. Install Python 3.12 and `httpx==0.28.1`; for the included
controller also install `os-ken==2.11.2 eventlet==0.40.3 setuptools==80.9.0`.

Set SENTINEL_API_URL, COLLECTOR_TOKEN, COLLECTOR_ID, CONTROLLER_URL, and
ALLOW_MITIGATION=false in your process environment from your private .env file.
For a host-run collector using the local Sentinel API, use
SENTINEL_API_URL=http://localhost:8100 (the bundled Docker setup uses
host.docker.internal to reach the host). Then run `python -m collector.agent`.
The controller must have observed IPv4 traffic; a heartbeat alone does not create
flow measurements. An inaccessible controller is shown as unreachable.

## What to expect

Only measured counters from this key's workspace appear. The first observation
establishes a baseline; the next creates a delta window. Data persists after
reload, and an offline collector is explicitly marked offline after 75 seconds.
ML inference uses a shared pretrained research model, not a model trained on your
new network. Its public metrics are not your network's accuracy. Model flags need
investigation. Mitigation remains disabled. Revoke the key immediately if exposed.
""",
        )
    return output.getvalue()


@router.post("/collector-setup")
async def download_setup(request: Request, user=Depends(administrator)):
    # All files must exist before persisting the credential; build failures roll back.
    origin = urlsplit(settings().google_redirect_uri or str(request.base_url))
    api_url = f"{origin.scheme}://{origin.netloc}"
    if origin.hostname in ("localhost", "127.0.0.1"):
        api_url = "http://host.docker.internal:8100"
    token = "snc_" + secrets.token_urlsafe(48)
    bundle = collector_bundle(api_url, token, user["workspace_id"])
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(user["workspace_id"]),))
        active = await (
            await conn.execute(
                "SELECT id FROM collector_credentials WHERE workspace_id=%s AND revoked_at IS NULL",
                (user["workspace_id"],),
            )
        ).fetchone()
        if active:
            raise HTTPException(
                409,
                "A collector key already exists. Use your downloaded bundle, or revoke that key before creating a replacement.",
            )
        key_id = uuid4()
        await conn.execute(
            "INSERT INTO collector_credentials(id,workspace_id,token_hash,prefix,created_by) VALUES (%s,%s,%s,%s,%s)",
            (key_id, user["workspace_id"], digest(token), token[:12], user["id"]),
        )
        await db.audit(conn, user["id"], "collector.key_created", key_id)
    return Response(
        bundle,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="sentinel-network-setup.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/collector-key/revoke")
async def revoke_key(user=Depends(administrator)):
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(user["workspace_id"]),))
        row = await (
            await conn.execute(
                "UPDATE collector_credentials SET revoked_at=now() WHERE workspace_id=%s AND revoked_at IS NULL RETURNING id",
                (user["workspace_id"],),
            )
        ).fetchone()
        if row:
            await db.audit(conn, user["id"], "collector.key_revoked", row["id"])
    return {"ok": True, "revoked": bool(row)}
