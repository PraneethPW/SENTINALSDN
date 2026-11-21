import asyncio
from unittest.mock import AsyncMock

import pytest

from app.db import db
from app.realtime import LiveHub


@pytest.mark.parametrize("subscribers", [0, 1])
async def test_revision_poll_only_uses_database_with_active_subscribers(monkeypatch, subscribers):
    hub = LiveHub()
    hub.subscribers = subscribers
    query = AsyncMock(return_value={"revision": 7})
    monkeypatch.setattr(db, "pool", object())
    monkeypatch.setattr(db, "one", query)
    # End after one iteration, without real sleeps or a live database.
    monkeypatch.setattr(asyncio, "sleep", AsyncMock(side_effect=asyncio.CancelledError))
    with pytest.raises(asyncio.CancelledError):
        await hub.run()
    assert query.await_count == subscribers
    if subscribers:
        assert hub.revision == 7
