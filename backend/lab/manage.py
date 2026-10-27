"""Build/start/stop the isolated lab using Docker; secrets stay out of command arguments."""

import argparse
import os
import subprocess
from pathlib import Path

from app.config import settings

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("action", choices=["build", "start", "stop", "logs"])
parser.add_argument("--context", default="default")
parser.add_argument("--api", default="http://host.docker.internal:8000")
args = parser.parse_args()
docker = ["docker", "--context", args.context]
if args.action == "build":
    subprocess.run(
        docker + ["build", "-f", "lab/Dockerfile", "-t", "sentinel-sdn-lab:local", "."], check=True
    )
elif args.action == "start":
    config = settings()
    if not config.collector_token:
        raise SystemExit("Set COLLECTOR_TOKEN in backend/.env first")
    environment = os.environ | {"COLLECTOR_TOKEN": config.collector_token}
    subprocess.run(
        docker
        + [
            "run",
            "-d",
            "--name",
            "sentinel-sdn-lab",
            "--privileged",
            "--add-host",
            "host.docker.internal:host-gateway",
            "--env",
            "COLLECTOR_TOKEN",
            "--env",
            f"SENTINEL_API_URL={args.api}",
            "--env",
            "COLLECTOR_ID=local-mininet-lab",
            "--env",
            "POLL_SECONDS=30",
            "sentinel-sdn-lab:local",
        ],
        env=environment,
        check=True,
    )
elif args.action == "stop":
    subprocess.run(docker + ["stop", "--time", "10", "sentinel-sdn-lab"], check=True)
    subprocess.run(docker + ["rm", "sentinel-sdn-lab"], check=True)
else:
    subprocess.run(
        docker
        + [
            "exec",
            "sentinel-sdn-lab",
            "sh",
            "-c",
            "tail -40 /tmp/collector.log; tail -30 /tmp/controller.log",
        ],
        check=True,
    )
