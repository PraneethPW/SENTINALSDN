"""Native development API: python -m app (including Windows PostgreSQL support)."""

import argparse
import asyncio

import uvicorn


def loop_factory():
    # Psycopg async connections require a selector loop on Windows. Uvicorn's
    # default single-process Windows loop is a ProactorEventLoop.
    return asyncio.SelectorEventLoop()


def main():
    parser = argparse.ArgumentParser(description="Run the native Sentinel API and bundled model.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8100)
    args = parser.parse_args()
    uvicorn.run(
        "app.main:app", host=args.host, port=args.port,
        loop="app.__main__:loop_factory",
    )


if __name__ == "__main__":
    main()
