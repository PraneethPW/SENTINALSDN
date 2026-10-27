#!/bin/sh
set -eu
python -m app.db
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log --timeout-keep-alive 15 --ws-max-size 16384
