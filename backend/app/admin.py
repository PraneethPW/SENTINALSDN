import argparse
import asyncio
import getpass
from uuid import uuid4

from app.db import db
from app.security import passwords


async def create(email: str, role: str):
    password = getpass.getpass("New password (minimum 14 characters): ")
    if len(password) < 14 or password != getpass.getpass("Confirm password: "):
        raise ValueError("Passwords must match and be at least 14 characters")
    await db.open()
    try:
        async with db.connection() as conn:
            user_id = uuid4()
            await conn.execute(
                "INSERT INTO users(id,email,password_hash,role) VALUES (%s,%s,%s,%s)",
                (user_id, email.strip().lower(), passwords.hash(password), role),
            )
            await db.audit(conn, "cli", "user.created", user_id, {"role": role})
        print(f"Created {role}: {email}")
    finally:
        await db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Create an operator account; passwords never appear in arguments"
    )
    parser.add_argument("email")
    parser.add_argument("--role", choices=["admin", "operator", "viewer"], default="admin")
    args = parser.parse_args()
    asyncio.run(create(args.email, args.role))
