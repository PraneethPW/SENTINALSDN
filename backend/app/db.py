import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.config import settings


class Database:
    def __init__(self):
        self.pool: AsyncConnectionPool | None = None

    async def open(self):
        if not settings().database_url:
            return
        self.pool = AsyncConnectionPool(
            settings().database_url,
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"row_factory": dict_row},
            timeout=8,
        )
        await self.pool.open()
        await self.pool.wait(timeout=15)

    async def close(self):
        if self.pool:
            await self.pool.close()

    @asynccontextmanager
    async def connection(self):
        if not self.pool:
            from fastapi import HTTPException

            raise HTTPException(
                503, "Database not configured. Set DATABASE_URL for local PostgreSQL or Neon."
            )
        async with self.pool.connection() as conn:
            # Transaction-local settings work through Neon's transaction pooler.
            # This schema prevents collisions with other applications' tables.
            await conn.execute("SET LOCAL search_path TO sentinel")
            yield conn

    async def fetch(self, query: str, params=()):
        async with self.connection() as conn:
            cursor = await conn.execute(query, params)
            return await cursor.fetchall() if cursor.description else []

    async def one(self, query: str, params=()):
        rows = await self.fetch(query, params)
        return rows[0] if rows else None

    async def audit(self, conn, actor, action, resource, detail=None):
        await conn.execute(
            "INSERT INTO audit_log(actor,action,resource,detail) VALUES (%s,%s,%s,%s)",
            (str(actor), action, str(resource), Jsonb(detail or {})),
        )


db = Database()


async def migrate():
    await db.open()
    async with db.connection() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(739142010)")
        await conn.execute(Path(__file__).with_name("schema.sql").read_text())
        for path in sorted(Path(__file__).with_name("migrations").glob("*.sql")):
            version = int(path.name.split("_", 1)[0])
            exists = await (
                await conn.execute("SELECT 1 FROM schema_versions WHERE version=%s", (version,))
            ).fetchone()
            if not exists:
                await conn.execute(path.read_text())
    await db.close()


if __name__ == "__main__":
    asyncio.run(migrate())
