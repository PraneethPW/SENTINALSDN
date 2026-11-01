"""Shared snapshot fanout. Durable committed event revisions, independent of subscriber count.

Clients always resume with a complete consistent snapshot, so disconnects do not lose state.
A bounded 500 ms revision poll supports Neon transaction pooling without session LISTEN.
"""

import asyncio
import time
from app.db import db


class LiveHub:
    def __init__(self):
        self.cache = {}
        self.revision = -1
        self.changed = asyncio.Condition()
        self.task = None
        self.locks = {}
        self.last_tick = 0

    async def start(self):
        self.cache = {}
        self.locks = {}
        self.changed = asyncio.Condition()
        self.revision = -1
        self.last_tick = 0
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        self.cache.clear()

    async def run(self):
        import logging

        while True:
            try:
                if not db.pool:
                    await asyncio.sleep(1)
                    continue
                row = await db.one("SELECT COALESCE(max(id),0) AS revision FROM realtime_events")
                revision = row["revision"]
                # A clock refresh expires offline collectors, rate windows and temporary rules.
                if revision != self.revision or time.monotonic() - self.last_tick >= 5:
                    self.revision = revision
                    self.last_tick = time.monotonic()
                    self.cache.clear()
                    async with self.changed:
                        self.changed.notify_all()
            except Exception:
                logging.getLogger(__name__).exception("Live revision read failed; retrying")
            await asyncio.sleep(0.5)

    async def snapshot(self, minutes, workspace_id):
        from app.api import snapshot

        key = (str(workspace_id), minutes)
        if len(self.locks) > 512:
            self.locks = {k: lock for k, lock in self.locks.items() if lock.locked() or k == key}
        lock = self.locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self.cache.get(key)
            if cached and time.monotonic() - cached[0] < 5:
                return cached[1]
            revision = self.revision
            data = await snapshot(minutes, workspace_id=workspace_id)
            data["revision"] = str(revision)
            # Do not cache across a revision invalidation while the SQL snapshot was built.
            if revision == self.revision:
                self.cache[key] = (time.monotonic(), data)
            return data


hub = LiveHub()
