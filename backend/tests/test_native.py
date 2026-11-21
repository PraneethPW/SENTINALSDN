"""Exercise the documented native command on both Windows and Unix CI."""

import asyncio
import hashlib
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
from uvicorn import Config


def test_native_launcher_uses_postgres_compatible_selector_loop():
    factory = Config("app.main:app", loop="app.__main__:loop_factory").get_loop_factory()
    loop = factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()


def test_native_command_loads_and_scores_the_bundled_model():
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    model = Path("artifacts/model.joblib").absolute()
    environment = {
        **os.environ, "ENVIRONMENT": "development", "DATABASE_URL": "",
        "MODEL_PATH": str(model), "MODEL_SHA256": hashlib.sha256(model.read_bytes()).hexdigest(),
    }
    with subprocess.Popen(
        [sys.executable, "-m", "app", "--port", str(port)], env=environment,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ) as process:
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10) as client:
                deadline = time.monotonic() + 30
                while True:
                    assert process.poll() is None, "Native API exited before readiness"
                    try:
                        ready = client.get("/health/public")
                        if ready.status_code == 200:
                            break
                    except httpx.TransportError:
                        pass
                    assert time.monotonic() < deadline, "Native model did not become ready"
                    time.sleep(0.2)
                assert ready.json()["ready"]
                run = client.post("/api/benchmark/run")
                assert run.status_code == 200
                assert len(run.json()["windows"]) == 4050
        finally:
            process.terminate()
            process.wait(timeout=15)
