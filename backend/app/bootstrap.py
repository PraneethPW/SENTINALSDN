"""Initialize a private local account from generated environment, never in production."""

import asyncio
import os
from uuid import uuid4
from app.config import settings
from app.db import db
from app.security import passwords


async def main():
    if settings().environment == "production" or not os.getenv("BOOTSTRAP_PASSWORD"):
        return
    password = os.environ["BOOTSTRAP_PASSWORD"]
    email = os.environ["BOOTSTRAP_EMAIL"]
    if len(password) < 14:
        raise ValueError("Bootstrap password must contain at least 14 characters")
    encoded = await asyncio.to_thread(passwords.hash, password)
    await db.open()
    try:
        await db.fetch(
            "INSERT INTO users(id,email,password_hash,role) VALUES (%s,%s,%s,'admin') ON CONFLICT(email) DO NOTHING",
            (uuid4(), email, encoded),
        )
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
