"""Public account entry, approval boundary and Google OIDC with browser-bound handoff."""

import asyncio
import base64
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.db import db
from app.detector import detector
from app.security import digest, passwords, public_user, identity_user

router = APIRouter(prefix="/api")


async def personal_workspace(conn, name, email):
    workspace_id = uuid4()
    label = (name.strip() or email.split("@", 1)[0])[:64] + "'s network"
    await conn.execute("INSERT INTO workspaces(id,name) VALUES (%s,%s)", (workspace_id, label))
    return workspace_id


def challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


async def entry_limit(request: Request):
    # Use the peer address, not untrusted forwarded headers. Shared by replicas.
    identity = "entry:" + digest(request.client.host if request.client else "unknown")
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (identity,))
        row = await (
            await conn.execute(
                "SELECT count(*) AS n FROM login_attempts WHERE identity=%s AND attempted_at>now()-interval '1 hour'",
                (identity,),
            )
        ).fetchone()
        if row["n"] >= 30:
            raise HTTPException(429, "Too many account requests. Please try again later.")
        await conn.execute("INSERT INTO login_attempts(identity) VALUES (%s)", (identity,))


class Registration(BaseModel):
    display_name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=14, max_length=256)

    @field_validator("email")
    @classmethod
    def email_format(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address")
        return value

    @field_validator("display_name")
    @classmethod
    def meaningful_name(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError("Enter your name")
        return value


async def session_result(conn, user):
    token = secrets.token_urlsafe(48)
    expiry = datetime.now(timezone.utc) + timedelta(hours=settings().session_hours)
    await conn.execute(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (%s,%s,%s)",
        (digest(token), user["id"], expiry),
    )
    await db.audit(conn, user["id"], "auth.session_created", user["id"])
    return {"token": token, "expires_at": expiry, "user": public_user(user)}


@router.get("/auth/config")
async def auth_config():
    config = settings()
    return {
        "registration": config.registration_enabled,
        "google": bool(
            config.google_client_id and config.google_client_secret and config.google_redirect_uri
        ),
        "access": "private_workspace",
    }


@router.get("/auth/connections")
async def connections(user=Depends(identity_user)):
    linked = await db.one(
        "SELECT 1 FROM oauth_identities WHERE user_id=%s AND provider='google'", (user["id"],)
    )
    return {"google": bool(linked), "password": user["password_enabled"]}


@router.post("/auth/google/link-ticket")
async def link_ticket(user=Depends(identity_user)):
    ticket = secrets.token_urlsafe(32)
    await db.fetch(
        "INSERT INTO oauth_link_tickets(ticket_hash,session_hash,expires_at) VALUES (%s,%s,now()+interval '30 seconds')",
        (digest(ticket), user["token_hash"]),
    )
    return {"ticket": ticket}


@router.get("/public/overview")
async def public_overview():
    # Model facts are already published in the source repository. No operational data.
    meta = detector.metadata or {}
    report = meta.get("classification_report", {}).get("1", {})
    return {
        "model_ready": (detector.model is not None),
        "version": meta.get("version"),
        "algorithm": meta.get("algorithm"),
        "features": len(meta.get("features", [])) if (detector.model is not None) else None,
        "window_seconds": meta.get("window_seconds") if (detector.model is not None) else None,
        "precision": report.get("precision") if (detector.model is not None) else None,
        "recall": report.get("recall") if (detector.model is not None) else None,
        "scope": "Public laboratory group-test evaluation; independent network validation required",
    }


@router.post("/auth/register", status_code=201, dependencies=[Depends(entry_limit)])
async def register(body: Registration):
    if not settings().registration_enabled:
        raise HTTPException(403, "Registration is currently closed. Contact your workspace administrator.")
    encoded = await asyncio.to_thread(passwords.hash, body.password)
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(739142020)")
        if await (await conn.execute("SELECT id FROM users WHERE email=%s", (body.email,))).fetchone():
            raise HTTPException(409, "An account already uses this email. Sign in instead.")
        workspace_id = await personal_workspace(conn, body.display_name, body.email)
        user = await (
            await conn.execute(
                "INSERT INTO users(id,email,display_name,password_hash,role,approved,workspace_id) VALUES (%s,%s,%s,%s,'admin',true,%s) RETURNING *",
                (uuid4(), body.email, body.display_name, encoded, workspace_id),
            )
        ).fetchone()
        await db.audit(
            conn,
            user["id"],
            "account.registered",
            user["id"],
            {"provider": "password", "workspace": "private"},
        )
        return await session_result(conn, user)


@router.get("/auth/google/start", dependencies=[Depends(entry_limit)])
async def google_start(
    request: Request,
    origin: str,
    handoff_challenge: str = Query(pattern=r"^[A-Za-z0-9_-]{43}$"),
    link_ticket: str = Query("", max_length=150),
):
    config = settings()
    if not (config.google_client_id and config.google_client_secret and config.google_redirect_uri):
        raise HTTPException(503, "Google sign-in is awaiting provider configuration. Use email sign-in.")
    if origin not in config.origins:
        raise HTTPException(400, "Return origin is not allowed")
    linked_session = None
    if link_ticket:
        linked = await db.one(
            "DELETE FROM oauth_link_tickets t USING sessions s,users u WHERE t.ticket_hash=%s AND t.session_hash=s.token_hash AND s.user_id=u.id AND u.active AND t.expires_at>now() AND s.expires_at>now() RETURNING t.session_hash",
            (digest(link_ticket),),
        )
        if not linked:
            raise HTTPException(401, "Google connection request expired. Sign in again.")
        linked_session = linked["session_hash"]
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    await db.fetch(
        "INSERT INTO oauth_states(state_hash,nonce,verifier,origin,handoff_challenge,link_session_hash,expires_at) VALUES (%s,%s,%s,%s,%s,%s,now()+interval '10 minutes')",
        (digest(state), nonce, verifier, origin, handoff_challenge, linked_session),
    )
    query = urlencode(
        {
            "client_id": config.google_client_id,
            "redirect_uri": config.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge(verifier),
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    response = RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth?" + query, status_code=303)
    response.set_cookie(
        "sentinel.oauth",
        state,
        max_age=600,
        httponly=True,
        secure=config.google_redirect_uri.startswith("https://"),
        samesite="lax",
        path="/api/auth/google",
    )
    return response


def verify_google(token, audience):
    from google.auth.transport.requests import Request as GoogleRequest
    from google.oauth2.id_token import verify_oauth2_token
    import requests

    with requests.Session() as session:
        transport = GoogleRequest(session=session)

        def bounded_request(*args, **kwargs):
            kwargs["timeout"] = 10
            return transport(*args, **kwargs)

        return verify_oauth2_token(token, bounded_request, audience=audience)


@router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    state: str = Query("", max_length=200),
    code: str = Query("", max_length=4096),
    error: str = Query("", max_length=200),
):
    cookie = request.cookies.get("sentinel.oauth", "")
    if not state or not cookie or not secrets.compare_digest(cookie, state):
        raise HTTPException(400, "Google sign-in state expired or did not match this browser. Start again.")
    row = await db.one(
        "DELETE FROM oauth_states WHERE state_hash=%s AND expires_at>now() RETURNING *", (digest(state),)
    )
    if not row:
        raise HTTPException(400, "This Google sign-in request has expired or was already used")

    def finish(path):
        response = RedirectResponse(row["origin"] + path, status_code=303)
        response.delete_cookie("sentinel.oauth", path="/api/auth/google")
        return response

    if error or not code:
        return finish("/auth/sign-in?error=google_cancelled")
    config = settings()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            result = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "client_id": config.google_client_id,
                    "client_secret": config.google_client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": config.google_redirect_uri,
                    "code_verifier": row["verifier"],
                },
            )
            result.raise_for_status()
        claims = await asyncio.to_thread(verify_google, result.json()["id_token"], config.google_client_id)
        if (
            claims.get("email_verified") is not True
            or not secrets.compare_digest(str(claims.get("nonce", "")), row["nonce"])
            or not claims.get("sub")
        ):
            raise ValueError("Google identity was not verified")
        email = str(claims["email"]).strip().lower()
    except Exception:
        # Never expose provider tokens, authorization codes or claims in logs/errors.
        return finish("/auth/sign-in?error=google_unavailable")
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(739142020)")
        if row["link_session_hash"]:
            user = await (
                await conn.execute(
                    "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now() AND u.active",
                    (row["link_session_hash"],),
                )
            ).fetchone()
            if not user or user["email"] != email:
                return finish("/auth/sign-in?error=google_link_mismatch")
            other = await (
                await conn.execute(
                    "SELECT * FROM oauth_identities WHERE provider='google' AND (subject=%s OR user_id=%s)",
                    (claims["sub"], user["id"]),
                )
            ).fetchall()
            if any(x["user_id"] != user["id"] or x["subject"] != claims["sub"] for x in other):
                return finish("/auth/sign-in?error=google_link_conflict")
            await conn.execute(
                "INSERT INTO oauth_identities(provider,subject,user_id) VALUES ('google',%s,%s) ON CONFLICT DO NOTHING",
                (claims["sub"], user["id"]),
            )
            await db.audit(conn, user["id"], "auth.google_connected", user["id"])
        else:
            user = await (
                await conn.execute(
                    "SELECT u.* FROM oauth_identities o JOIN users u ON u.id=o.user_id WHERE o.provider='google' AND o.subject=%s",
                    (claims["sub"],),
                )
            ).fetchone()
            if not user:
                # Email equality is not authority to link an existing password account.
                if await (await conn.execute("SELECT id FROM users WHERE email=%s", (email,))).fetchone():
                    return finish("/auth/sign-in?error=existing_email")
                if not config.registration_enabled:
                    return finish("/auth/sign-in?error=registration_closed")
                workspace_id = await personal_workspace(conn, str(claims.get("name", "")), email)
                user = await (
                    await conn.execute(
                        "INSERT INTO users(id,email,display_name,password_hash,role,approved,password_enabled,workspace_id) VALUES (%s,%s,%s,'!google-only','admin',true,false,%s) RETURNING *",
                        (uuid4(), email, str(claims.get("name", ""))[:80], workspace_id),
                    )
                ).fetchone()
                await conn.execute(
                    "INSERT INTO oauth_identities(provider,subject,user_id) VALUES ('google',%s,%s)",
                    (claims["sub"], user["id"]),
                )
                await db.audit(
                    conn,
                    user["id"],
                    "account.registered",
                    user["id"],
                    {"provider": "google", "workspace": "private"},
                )
        if not user["active"]:
            return finish("/auth/sign-in?error=account_unavailable")
        handoff = secrets.token_urlsafe(48)
        await conn.execute(
            "INSERT INTO oauth_handoffs(code_hash,user_id,challenge,expires_at) VALUES (%s,%s,%s,now()+interval '60 seconds')",
            (digest(handoff), user["id"], row["handoff_challenge"]),
        )
    return finish("/auth/callback#code=" + handoff)


class GoogleExchange(BaseModel):
    code: str = Field(min_length=40, max_length=150)
    verifier: str = Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/auth/google/exchange")
async def google_exchange(body: GoogleExchange):
    async with db.connection() as conn:
        handoff = await (
            await conn.execute(
                "SELECT * FROM oauth_handoffs WHERE code_hash=%s AND expires_at>now() FOR UPDATE",
                (digest(body.code),),
            )
        ).fetchone()
        if not handoff or not secrets.compare_digest(handoff["challenge"], challenge(body.verifier)):
            raise HTTPException(401, "Google sign-in expired or belongs to another browser. Start again.")
        user = await (
            await conn.execute("SELECT * FROM users WHERE id=%s AND active", (handoff["user_id"],))
        ).fetchone()
        if not user:
            raise HTTPException(401, "Account unavailable")
        await conn.execute("DELETE FROM oauth_handoffs WHERE code_hash=%s", (digest(body.code),))
        return await session_result(conn, user)
