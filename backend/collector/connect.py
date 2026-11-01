"""Standalone launcher included at the root of a private workspace setup ZIP."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys


def executable(name):
    found = shutil.which(name)
    if found:
        return found
    for folder in ("/opt/homebrew/bin", "/usr/local/bin"):
        candidate = Path(folder) / name
        if candidate.is_file():
            return str(candidate)
    return None


def succeeds(command):
    try:
        return subprocess.run(command, capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Start, inspect, or stop this workspace's real isolated SDN lab."
    )
    parser.add_argument("action", choices=("up", "down", "status", "logs"))
    parser.add_argument(
        "--context", help="Optional explicit Docker context; otherwise detect a running engine"
    )
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    if not (folder / "compose.yml").is_file() or not (folder / ".env").is_file():
        raise SystemExit(
            "Extract the complete setup ZIP first; compose.yml and the private .env must be beside connect.py."
        )
    docker = executable("docker")
    if not docker:
        raise SystemExit(
            "Install Docker Desktop or Docker Engine with Compose, start its Linux engine, then retry."
        )
    if args.context:
        contexts = [args.context]
    else:
        current = subprocess.run([docker, "context", "show"], capture_output=True, text=True, timeout=10)
        contexts = list(
            dict.fromkeys(
                [current.stdout.strip() or "default", "colima-sentinel-sdn", "colima", "desktop-linux"]
            )
        )
    context = next(
        (name for name in contexts if succeeds([docker, "--context", name, "info", "--format", "{{.ID}}"])),
        None,
    )
    if not context:
        raise SystemExit(
            "No running Docker engine was found. Start Docker Desktop or your Colima VM, then retry. For the Sentinel local stack, npm run local:up starts its dedicated VM."
        )
    command = [docker, "--context", context, "compose"]
    if not succeeds(command + ["version"]):
        standalone = executable("docker-compose")
        if not standalone:
            raise SystemExit(
                "Docker is running, but Compose is missing. Install the official Compose plugin or docker-compose, then retry."
            )
        command = [standalone, "--context", context]
    command += ["--env-file", str(folder / ".env"), "-f", str(folder / "compose.yml")]
    print("Using Docker context: " + context, flush=True)
    if os.name != "nt":
        (folder / ".env").chmod(0o600)
    options = {
        "up": ["up", "-d", "--build"],
        "down": ["down"],
        "status": ["ps"],
        "logs": ["exec", "-T", "lab", "tail", "-60", "/tmp/collector.log"],
    }
    result = subprocess.run(command + options[args.action], cwd=folder)
    if result.returncode:
        raise SystemExit(result.returncode)
    if args.action == "up":
        print(
            "Lab started. Return to Sentinel → Network setup. Allow 60–90 seconds for baseline and flow windows."
        )
        print(
            "This is isolated Mininet traffic, not your normal computer traffic. Stop it with: python3 connect.py down"
        )


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.TimeoutExpired) as error:
        print("Docker could not complete the operation: " + str(error), file=sys.stderr)
        raise SystemExit(1) from None
