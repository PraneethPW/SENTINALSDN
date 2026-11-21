#!/bin/sh
set -eu
# Lifespan initializes migrations/accounts and retries database outages. Public
# model evaluation must remain available when the workspace database is offline.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --timeout-keep-alive 15 --ws-max-size 16384
