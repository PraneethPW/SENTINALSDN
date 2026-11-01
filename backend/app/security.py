import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.db import db

passwords = PasswordHasher()
bearer = HTTPBearer(auto_error=False)
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def verify(password: str, encoded: str) -> bool:
    try:
        return passwords.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


async def user_from_token(token: str):
    user = await db.one(
        """SELECT u.id,u.email,u.role,u.approved,u.display_name,u.password_enabled,u.workspace_id,s.expires_at,s.token_hash FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now() AND u.active""",
        (digest(token),),
    )
    if not user:
        raise HTTPException(401, "Session expired. Sign in again.")
    return user


async def identity_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, "Sign in to access your network.")
    return await user_from_token(credentials.credentials)


async def current_user(user=Depends(identity_user)):
    if not user["approved"]:
        raise HTTPException(403, "Your account is awaiting workspace approval")
    return user


async def operator(user=Depends(current_user)):
    if user["role"] not in ("operator", "admin"):
        raise HTTPException(403, "Operator access required")
    return user


async def collector_auth(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, "Invalid collector token")
    configured = settings().collector_token
    if configured and secrets.compare_digest(digest(credentials.credentials), digest(configured)):
        return {
            "workspace_id": "00000000-0000-0000-0000-000000000001",
            "lab_run_id": None,
            "collector_id": None,
        }
    row = await db.one(
        """UPDATE collector_credentials c SET last_used_at=now() WHERE token_hash=%s AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at>now()) AND (lab_run_id IS NULL OR EXISTS
        (SELECT 1 FROM managed_labs l WHERE l.id=c.lab_run_id AND l.desired_state='running'
         AND l.expires_at>now() AND l.idle_expires_at>now())) RETURNING workspace_id,lab_run_id""",
        (digest(credentials.credentials),),
    )
    if not row:
        raise HTTPException(401, "Invalid or revoked collector token")
    return {
        "workspace_id": str(row["workspace_id"]),
        "lab_run_id": row["lab_run_id"],
        "collector_id": "lab-" + row["lab_run_id"].hex if row["lab_run_id"] else None,
    }


def check_collector(scope, collector_id):
    if scope["collector_id"] and scope["collector_id"] != collector_id:
        raise HTTPException(403, "This credential belongs to another lab collector")


def public_user(user):
    return {
        k: str(user[k]) if k in ("id", "workspace_id") else user[k]
        for k in ("id", "email", "role", "approved", "display_name", "password_enabled", "workspace_id")
    }
