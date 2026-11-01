"""Authenticated account management and keyset-paginated measured history."""

import asyncio
import re
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from typing import Literal
from app.db import db
from app.security import current_user, passwords, verify

router = APIRouter(prefix="/api")


async def administrator(user=Depends(current_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Administrator access required")
    return user


class NewUser(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=14, max_length=256)
    role: Literal["admin", "operator", "viewer"] = "viewer"

    @field_validator("email")
    @classmethod
    def email_format(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address")
        return value


class ChangeUser(BaseModel):
    role: Literal["admin", "operator", "viewer"]
    active: bool
    approved: bool | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=14, max_length=256)


@router.get("/users")
async def list_users(user=Depends(current_user)):
    # Operators need names for assignment; no password/session fields are exposed.
    return await db.fetch(
        "SELECT id,email,role,active,approved,display_name,password_enabled,created_at FROM users ORDER BY created_at,id"
    )


@router.post("/users", status_code=201)
async def create_user(body: NewUser, user=Depends(administrator)):
    encoded = await asyncio.to_thread(passwords.hash, body.password)
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(739142020)")
        if await (await conn.execute("SELECT 1 FROM users WHERE email=%s", (body.email,))).fetchone():
            raise HTTPException(409, "An account with this email already exists")
        result = await conn.execute(
            "INSERT INTO users(id,email,password_hash,role) VALUES (%s,%s,%s,%s) RETURNING id,email,role,active",
            (uuid4(), body.email, encoded, body.role),
        )
        account = await result.fetchone()
        await db.audit(conn, user["id"], "user.created", account["id"], {"role": body.role})
    return account


@router.patch("/users/{user_id}")
async def change_user(user_id: UUID, body: ChangeUser, user=Depends(administrator)):
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(739142020)")
        target = await (
            await conn.execute("SELECT * FROM users WHERE id=%s FOR UPDATE", (user_id,))
        ).fetchone()
        if not target:
            raise HTTPException(404, "Account not found")
        approved = target["approved"] if body.approved is None else body.approved
        if (
            target["active"]
            and target["approved"]
            and target["role"] == "admin"
            and (not body.active or not approved or body.role != "admin")
        ):
            count = await (
                await conn.execute(
                    "SELECT count(*) AS n FROM users WHERE role='admin' AND active AND approved"
                )
            ).fetchone()
            if count["n"] <= 1:
                raise HTTPException(409, "The workspace must retain an active administrator")
        await conn.execute(
            "UPDATE users SET role=%s,active=%s,approved=%s WHERE id=%s",
            (body.role, body.active, approved, user_id),
        )
        if target["role"] != body.role or target["active"] != body.active or not approved:
            await conn.execute("DELETE FROM sessions WHERE user_id=%s", (user_id,))
        await db.audit(conn, user["id"], "user.updated", user_id, body.model_dump())
    return {"id": user_id, **body.model_dump()}


@router.post("/auth/password")
async def change_password(body: PasswordChange, user=Depends(current_user)):
    target = await db.one("SELECT password_hash FROM users WHERE id=%s", (user["id"],))
    if not await asyncio.to_thread(verify, body.current_password, target["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if body.current_password == body.new_password:
        raise HTTPException(400, "Choose a different password")
    encoded = await asyncio.to_thread(passwords.hash, body.new_password)
    async with db.connection() as conn:
        await conn.execute("UPDATE users SET password_hash=%s WHERE id=%s", (encoded, user["id"]))
        await conn.execute("DELETE FROM sessions WHERE user_id=%s", (user["id"],))
        await db.audit(conn, user["id"], "auth.password_changed", user["id"])
    return {"ok": True, "detail": "Password changed. Sign in again on all devices."}


@router.get("/flows")
async def flow_history(
    minutes: int = Query(60, ge=1, le=10080),
    limit: int = Query(50, ge=1, le=100),
    cursor: int | None = Query(None, ge=1),
    search: str = Query("", max_length=100),
    verdict: Literal["all", "benign", "attack", "unclassified"] = "all",
    user=Depends(current_user),
):
    # Escape LIKE wildcards so search is a literal user string.
    term = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    rows = await db.fetch(
        """SELECT * FROM flows WHERE observed_at>now()-make_interval(mins=>%s)
        AND (%s::bigint IS NULL OR id<%s) AND (%s='all' OR prediction=%s)
        AND (source_ip::text ILIKE %s OR destination_ip::text ILIKE %s OR switch_id ILIKE %s)
        ORDER BY id DESC LIMIT %s""",
        (minutes, cursor, cursor, verdict, verdict, term, term, term, limit + 1),
    )
    return {"items": rows[:limit], "next_cursor": rows[limit - 1]["id"] if len(rows) > limit else None}
