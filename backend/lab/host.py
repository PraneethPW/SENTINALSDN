"""Trusted outbound-only reconciler for fixed, short-lived Mininet containers.

Runs on the research host, never in the public API. Uses only Python stdlib.
Config is private JSON; no user input is interpolated into shell commands.
"""

import argparse
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import time
from datetime import datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import UUID

VERSION = "1.4.0"
IMAGE = "sentinel-managed-lab:1.4"
OWNED = "com.sentinel.managed-lab"
ROOT = Path(__file__).resolve().parents[1]
LOG = logging.getLogger("lab-host")


class ApiError(Exception):
    def __init__(self, status):
        self.status = status


def api(source, path, body):
    request = Request(
        source["url"].rstrip("/") + "/api/lab-host" + path,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": "Bearer " + source["token"], "Content-Type": "application/json"},
    )
    try:
        with urlopen(
            request,
            timeout=12,
            context=ssl.create_default_context(
                cafile="/etc/ssl/cert.pem" if sys.platform == "darwin" else None
            ),
        ) as response:
            return json.load(response)
    except HTTPError as error:
        raise ApiError(error.code) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise ApiError(0) from None


def identity(source):
    return hashlib.sha256(source["url"].rstrip("/").encode()).hexdigest()[:16]


def fingerprint():
    result = hashlib.sha256()
    for file in sorted(
        [
            *ROOT.joinpath("collector").glob("*.py"),
            ROOT / "lab/Dockerfile",
            ROOT / "lab/network.py",
            ROOT / "lab/start.sh",
        ]
    ):
        result.update(file.read_bytes())
    return result.hexdigest()


def epoch(value):
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


class Host:
    def __init__(self, config):
        self.config = config
        self.docker = shutil.which("docker") or "/opt/homebrew/bin/docker"
        self.prefix = [self.docker, "--context", config.get("docker_context", "default")]
        self.capacity = min(8, max(1, int(config.get("capacity", 2))))
        self.sources = config["sources"]
        self.build = None
        self.build_log = None
        self.last_ready = {}
        self.last_vm_attempt = 0
        self.source_hash = fingerprint()

    def command(self, args, timeout=25, env=None):
        return subprocess.run(self.prefix + args, capture_output=True, text=True, timeout=timeout, env=env)

    def inventory(self):
        result = self.command(["ps", "-a", "--filter", "label=" + OWNED + "=1", "--format", "{{.ID}}"])
        if result.returncode:
            raise RuntimeError("docker unavailable")
        ids = result.stdout.split()
        if not ids:
            return {}
        result = self.command(["inspect", *ids])
        if result.returncode:
            raise RuntimeError("docker inspection unavailable")
        return {row["Config"]["Labels"]["com.sentinel.run"]: row for row in json.loads(result.stdout)}

    def remove(self, row):
        if row["Config"]["Labels"].get(OWNED) != "1":
            raise RuntimeError("refusing unowned container")
        result = self.command(["rm", "-f", row["Id"]])
        if result.returncode:
            raise RuntimeError("container cleanup failed")

    def image_ready(self):
        if self.build:
            status = self.build.poll()
            if status is None:
                return False
            self.build_log.close()
            self.build = None
            if status:
                LOG.error("Lab image build failed; details in image-build.log")
                return False
        result = self.command(
            ["image", "inspect", IMAGE, "--format", '{{index .Config.Labels "com.sentinel.source"}}']
        )
        if result.returncode == 0 and result.stdout.strip() == self.source_hash:
            return True
        self.build_log = open(Path(self.config["directory"]) / "image-build.log", "a")
        self.build = subprocess.Popen(
            self.prefix
            + [
                "build",
                "--label",
                "com.sentinel.source=" + self.source_hash,
                "-t",
                IMAGE,
                "-f",
                "lab/Dockerfile",
                ".",
            ],
            cwd=ROOT,
            stdout=self.build_log,
            stderr=subprocess.STDOUT,
        )
        LOG.info("Preparing trusted lab image")
        return False

    def report(self, source, job, event, reason="ready"):
        return api(
            source,
            "/runs/" + str(UUID(job["id"])) + "/report",
            {"revision": job["revision"], "event": event, "reason": reason},
        )

    def start(self, source, job):
        run = str(UUID(job["id"]))
        claim = api(source, "/runs/" + run + "/claim", {"revision": job["revision"]})
        # Environment carries credentials; docker arguments and logs never contain them.
        env = dict(
            os.environ,
            SENTINEL_API_URL=source.get("collector_url", source["url"]),
            COLLECTOR_TOKEN=claim["collector_token"],
            COLLECTOR_ID=claim["collector_id"],
            POLL_SECONDS="30",
            ALLOW_MITIGATION="false",
            SPOOL_DIRECTORY="/tmp/sentinel-spool",
            SENTINEL_EXPIRES_EPOCH=str(epoch(claim["expires_at"])),
        )
        args = [
            "run",
            "-d",
            "--name",
            "sentinel-lab-" + UUID(run).hex,
            "--privileged",
            "--memory",
            "512m",
            "--cpus",
            "1",
            "--pids-limit",
            "384",
            "--restart",
            "no",
            "--log-opt",
            "max-size=5m",
            "--log-opt",
            "max-file=2",
            "--add-host",
            "host.docker.internal:host-gateway",
        ]
        for key, value in {
            OWNED: "1",
            "com.sentinel.run": run,
            "com.sentinel.workspace": str(UUID(claim["workspace_id"])),
            "com.sentinel.api": identity(source),
            "com.sentinel.expires": env["SENTINEL_EXPIRES_EPOCH"],
        }.items():
            args += ["--label", key + "=" + value]
        for key in (
            "SENTINEL_API_URL",
            "COLLECTOR_TOKEN",
            "COLLECTOR_ID",
            "POLL_SECONDS",
            "ALLOW_MITIGATION",
            "SPOOL_DIRECTORY",
            "SENTINEL_EXPIRES_EPOCH",
        ):
            args += ["-e", key]
        result = self.command(args + [IMAGE], timeout=45, env=env)
        if result.returncode:
            raise RuntimeError("container start failed")
        try:
            self.report(source, job, "container_running")
        except ApiError as error:
            if error.status in (401, 404, 409):
                row = self.inventory().get(run)
                if row:
                    self.remove(row)
            raise
        LOG.info("Started lab %s", run)

    def tick(self):
        try:
            inventory = self.inventory()
            ready = self.image_ready()
            reason = "ready" if ready else "preparing"
        except (OSError, subprocess.TimeoutExpired, RuntimeError, ValueError):
            inventory = None
            ready, reason = False, "docker_unavailable"
            # Only start our named no-mount VM, never modify a user's default context.
            if (
                sys.platform == "darwin"
                and self.config.get("docker_context") == "colima-sentinel-sdn"
                and time.monotonic() - self.last_vm_attempt > 120
            ):
                self.last_vm_attempt = time.monotonic()
                colima = shutil.which("colima") or "/opt/homebrew/bin/colima"
                subprocess.Popen(
                    [
                        colima,
                        "start",
                        "sentinel-sdn",
                        "--vm-type",
                        "vz",
                        "--cpus",
                        "4",
                        "--memory",
                        "6",
                        "--disk",
                        "12",
                        "--activate=false",
                        "--ssh-config=false",
                        "--mount",
                        "none",
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
        if inventory is not None:
            for run, row in list(inventory.items()):
                if int(row["Config"]["Labels"].get("com.sentinel.expires", "0")) <= time.time():
                    self.remove(row)
                    del inventory[run]
        for source in self.sources:
            try:
                other = sum(
                    1
                    for row in (inventory or {}).values()
                    if row["Config"]["Labels"].get("com.sentinel.api") != identity(source)
                )
                response = api(
                    source,
                    "/poll",
                    {
                        "ready": ready,
                        "capacity": self.capacity,
                        "external_busy": other,
                        "reason": reason,
                        "version": VERSION,
                    },
                )
                self.last_ready[identity(source)] = time.monotonic()
                if inventory is None:
                    continue
                jobs = response["jobs"]
                valid = {job["id"] for job in jobs}
                # Remove orphans only after an authenticated, successful API poll.
                for run, row in list(inventory.items()):
                    if (
                        row["Config"]["Labels"].get("com.sentinel.api") == identity(source)
                        and run not in valid
                    ):
                        self.remove(row)
                        del inventory[run]
                for job in sorted(jobs, key=lambda job: job["desired_state"] == "running"):
                    run = str(UUID(job["id"]))
                    row = inventory.get(run)
                    if job["desired_state"] == "stopped":
                        if row:
                            self.remove(row)
                            del inventory[run]
                        self.report(source, job, "stopped", "user_stop")
                    elif row:
                        if not row["State"]["Running"]:
                            self.remove(row)
                            del inventory[run]
                            self.report(source, job, "failed", "container_exited")
                        elif not job["started_at"]:
                            self.report(source, job, "container_running")
                    elif job["started_at"]:
                        self.report(source, job, "failed", "container_exited")
                    elif ready:
                        if len(inventory) >= self.capacity:
                            self.report(source, job, "waiting_capacity", "capacity")
                        else:
                            try:
                                self.start(source, job)
                            except (RuntimeError, subprocess.TimeoutExpired):
                                self.report(source, job, "failed", "start_failed")
                            inventory = self.inventory()
            except ApiError as error:
                LOG.warning("API %s unavailable (status %s)", identity(source), error.status)
            except (OSError, subprocess.TimeoutExpired, RuntimeError, ValueError, KeyError):
                LOG.exception("Host reconciliation failed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    config_path = Path(args.config).resolve()
    config = json.loads(config_path.read_text())
    if config_path.stat().st_mode & 0o077:
        raise RuntimeError("Host configuration must be private (chmod 600)")
    config["directory"] = str(config_path.parent)
    lock = open(config_path.parent / "host.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("Lab host already running")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    host = Host(config)
    while True:
        host.tick()
        time.sleep(5)


if __name__ == "__main__":
    main()
