"""Automatic hourly retention with a PostgreSQL lock; also callable as a maintenance CLI."""

import asyncio
import logging

from app.config import settings
from app.db import db

logger = logging.getLogger("sentinel.maintenance")


async def run_cleanup():
    async with db.connection() as conn:
        cursor = await conn.execute("SELECT pg_try_advisory_xact_lock(739142011) AS acquired")
        if not (await cursor.fetchone())["acquired"]:
            return
        await conn.execute(
            "DELETE FROM flows WHERE observed_at<now()-make_interval(days=>%s)", (settings().retention_days,)
        )
        await conn.execute(
            "DELETE FROM batches WHERE received_at<now()-make_interval(days=>%s) AND NOT EXISTS(SELECT 1 FROM flows WHERE batch_id=batches.id)",
            (settings().retention_days,),
        )
        await conn.execute("DELETE FROM ws_tickets WHERE expires_at<now()")
        await conn.execute("DELETE FROM sessions WHERE expires_at<now()")
        await conn.execute("DELETE FROM login_attempts WHERE attempted_at<now()-interval '1 day'")
        await conn.execute(
            "UPDATE commands SET status='expired' WHERE status='enforced' AND expires_at<=now()"
        )
        await db.audit(
            conn, "maintenance", "retention.completed", "flows", {"days": settings().retention_days}
        )


async def retention_loop():
    await asyncio.sleep(60)
    while True:
        try:
            await run_cleanup()
        except Exception:
            logger.exception("Retention job failed; retrying at the next hourly interval")
        await asyncio.sleep(3600)


async def cleanup():
    await db.open()
    try:
        await run_cleanup()
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(cleanup())
