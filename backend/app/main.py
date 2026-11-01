import asyncio
import logging
import re
import time
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import OperationalError
from psycopg_pool import PoolTimeout

from app.api import router
from app.config import settings
from app.db import db
from app.detector import detector
from app.ingest import router as ingest_router
from app.maintenance import retention_loop
from app.realtime import hub
from app.operations import router as operations_router
from app.security import digest
from app.public_auth import router as public_auth_router
from app.workspaces import router as workspace_router
from app.managed_labs import router as lab_router

logging.basicConfig(level=settings().log_level)
logger = logging.getLogger("sentinel")


class RedactTicket(logging.Filter):
    def filter(self, record):
        record.msg = re.sub(r"ticket=[^&\s\"]+", "ticket=[redacted]", record.getMessage())
        record.args = ()
        return True


logging.getLogger("uvicorn.error").addFilter(RedactTicket())


@asynccontextmanager
async def lifespan(app):
    await db.open()
    await asyncio.to_thread(detector.load)
    maintenance = asyncio.create_task(retention_loop())
    await hub.start()
    try:
        yield
    finally:
        await hub.stop()
        maintenance.cancel()
        with suppress(asyncio.CancelledError):
            await maintenance
        await db.close()


app = FastAPI(
    title="Sentinel SDN",
    version="1.4.0",
    lifespan=lifespan,
    docs_url="/docs" if settings().environment != "production" else None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings().origins,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(router)
app.include_router(ingest_router)
app.include_router(operations_router)
app.include_router(public_auth_router)
app.include_router(workspace_router)
app.include_router(lab_router)


@app.middleware("http")
async def request_boundary(request, call_next):
    request_id = str(uuid4())
    started = time.monotonic()
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    if content_length < 0:
        return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
    if content_length > 2_000_000:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    # Also enforce the cap on chunked requests before JSON parsing.
    received = 0
    original_receive = request._receive

    async def limited_receive():
        nonlocal received
        message = await original_receive()
        received += len(message.get("body", b""))
        if received > 2_000_000:
            from fastapi import HTTPException

            raise HTTPException(413, "Request too large")
        return message

    request._receive = limited_receive
    try:
        response = await call_next(request)
    except HTTPException as error:
        response = JSONResponse({"detail": error.detail}, error.status_code)
    except (OperationalError, PoolTimeout):
        logger.exception("Database unavailable request_id=%s", request_id)
        response = JSONResponse({"detail": "Database temporarily unavailable", "request_id": request_id}, 503)
    except Exception:
        logger.exception("Request failed request_id=%s", request_id)
        response = JSONResponse({"detail": "Unexpected server error", "request_id": request_id}, 500)
    response.headers.update(
        {
            "X-Request-ID": request_id,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
        }
    )
    logger.info(
        "request method=%s path=%s status=%d duration_ms=%.1f request_id=%s",
        request.method,
        request.url.path,
        response.status_code,
        (time.monotonic() - started) * 1000,
        request_id,
    )
    return response


@app.get("/health/live")
async def live():
    return {"status": "alive", "version": "1.4.0"}


@app.get("/health/ready")
async def ready():
    if not db.pool:
        return JSONResponse({"ready": False, "reason": "Database not configured"}, 503)
    await db.one("SELECT 1")
    return {"ready": True}


@app.websocket("/api/live")
async def live_socket(socket: WebSocket):
    if socket.headers.get("origin") not in settings().origins:
        await socket.close(code=4403)
        return
    ticket = socket.query_params.get("ticket", "")
    try:
        async with db.connection() as conn:
            cursor = await conn.execute(
                """DELETE FROM ws_tickets t USING sessions s
                WHERE t.session_hash=s.token_hash AND t.ticket_hash=%s AND t.expires_at>now()
                AND s.expires_at>now() RETURNING s.token_hash""",
                (digest(ticket),),
            )
            session = await cursor.fetchone()
        if not session:
            await socket.close(code=4401)
            return
        raw_minutes = socket.query_params.get("minutes", "15")
        if raw_minutes not in ("5", "15", "30", "60"):
            await socket.close(code=4400)
            return
        minutes = int(raw_minutes)
        await socket.accept()
        while True:
            valid = await db.one(
                "SELECT u.workspace_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=%s AND expires_at>now() AND u.active AND u.approved",
                (session["token_hash"],),
            )
            if not valid:
                await socket.close(code=4401)
                return
            await socket.send_json(jsonable_encoder(await hub.snapshot(minutes, valid["workspace_id"])))
            async with hub.changed:
                try:
                    await asyncio.wait_for(hub.changed.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Live stream closed")
        try:
            await socket.close(code=1011)
        except RuntimeError:
            pass
