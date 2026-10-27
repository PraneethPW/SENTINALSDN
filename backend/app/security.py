import hashlib
import secrets
from datetime import datetime, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
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
    except VerificationError:
        return False


async def user_from_token(token: str):
    user = await db.one(
        """SELECT u.id,u.email,u.role,s.expires_at,s.token_hash FROM sessions s
        JOIN users u ON u.id=s.user_id WHERE s.token_hash=%s AND s.expires_at>now()""",
        (digest(token),),
    )
    if not user:
        raise HTTPException(401, "Session expired. Sign in again.")
    return user


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, "Sign in to access your network.")
    return await user_from_token(credentials.credentials)


async def operator(user=Depends(current_user)):
    if user["role"] not in ("operator", "admin"):
        raise HTTPException(403, "Operator access required")
    return user


async def collector_auth(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    configured = settings().collector_token
    if not configured:
        raise HTTPException(503, "Collector authentication is not configured")
    if not credentials or not secrets.compare_digest(digest(credentials.credentials), digest(configured)):
        raise HTTPException(401, "Invalid collector token")


def public_user(user):
    return {k: str(user[k]) if k == "id" else user[k] for k in ("id", "email", "role")}
