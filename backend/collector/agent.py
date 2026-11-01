"""Run beside the SDN controller, never inside the cloud API container."""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import httpx

logger = logging.getLogger("collector")


class CounterTracker:
    def __init__(self):
        self.previous = {}

    def window(self, switch: str, entry: dict, now: float, observed_at: str):
        match = entry.get("match", {})
        source = match.get("ipv4_src", match.get("nw_src"))
        destination = match.get("ipv4_dst", match.get("nw_dst"))
        protocol = match.get("ip_proto", match.get("nw_proto"))
        if not source or not destination or "/" in source or "/" in destination or protocol not in (1, 6, 17):
            return None
        # Exclude table miss, drop rules, aggregate prefixes, and non-IPv4 rules.
        if not entry.get("actions") or entry.get("priority", 0) >= 50000:
            return None
        key = (
            switch,
            json.dumps(match, sort_keys=True),
            entry.get("cookie", 0),
            entry.get("table_id", 0),
            entry.get("priority", 0),
        )
        packets, byte_count = int(entry["packet_count"]), int(entry["byte_count"])
        duration = float(entry.get("duration_sec", 0)) + float(entry.get("duration_nsec", 0)) / 1e9
        previous = self.previous.get(key)
        self.previous[key] = (packets, byte_count, now, duration)
        if not previous:
            return None
        old_packets, old_bytes, old_time, old_duration = previous
        interval = now - old_time
        if (
            packets < old_packets
            or byte_count < old_bytes
            or duration < old_duration
            or not 0.1 <= interval <= 300
        ):
            return None
        delta_packets, delta_bytes = packets - old_packets, byte_count - old_bytes
        if delta_packets <= 0 or delta_bytes < delta_packets:
            return None
        port = match.get("tcp_dst", match.get("udp_dst", match.get("tp_dst")))
        return {
            "observed_at": observed_at,
            "switch_id": switch,
            "source_ip": source,
            "destination_ip": destination,
            "protocol": protocol,
            "destination_port": port,
            "packets": delta_packets,
            "bytes": delta_bytes,
            "interval_seconds": interval,
            "duration_seconds": duration,
        }

    def prune(self, now: float):
        self.previous = {key: value for key, value in self.previous.items() if now - value[2] < 600}


class Agent:
    def __init__(self):
        self.api = os.environ["SENTINEL_API_URL"].rstrip("/")
        self.token = os.environ["COLLECTOR_TOKEN"]
        self.controller = os.getenv("CONTROLLER_URL", "http://127.0.0.1:8080").rstrip("/")
        self.collector_id = os.getenv("COLLECTOR_ID", "sdn-edge-01")
        self.source_type = os.getenv("SENTINEL_SOURCE", "sdn_controller")
        self.interval = max(1, float(os.getenv("POLL_SECONDS", "30")))
        self.switch_allowlist = set(filter(None, os.getenv("MONITORED_SWITCHES", "").split(",")))
        self.mitigation = os.getenv("ALLOW_MITIGATION", "false").lower() == "true"
        self.spool = Path(os.getenv("SPOOL_DIRECTORY", ".spool"))
        self.spool.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.tracker = CounterTracker()
        if len(self.token) < 32:
            raise ValueError("Collector token must contain at least 32 characters")
        if (
            not (os.getenv("SENTINEL_LOCAL") == "true" and self.api == "http://api:8000")
            and not self.api.startswith("https://")
            and not self.api.startswith(
                ("http://localhost:", "http://127.0.0.1:", "http://host.docker.internal:")
            )
        ):
            raise ValueError("Cloud API must use HTTPS")

    def persist(self, batch):
        files = list(self.spool.iterdir())
        if len(files) >= 2000 or sum(p.stat().st_size for p in files if p.is_file()) > 256 * 1024 * 1024:
            raise RuntimeError(
                "Collector spool full. Restore API connectivity; no queued batches were overwritten."
            )
        target = self.spool / f"{time.time_ns()}-{batch['batch_id']}.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(batch))
        temporary.chmod(0o600)
        temporary.replace(target)

    async def flush(self, api):
        for path in sorted(self.spool.glob("*.json"))[:20]:
            # Ingestion accepts one-hour backfill. Preserve older batches for operator recovery.
            try:
                body = json.loads(path.read_text())
            except (json.JSONDecodeError, UnicodeDecodeError):
                logger.error("Corrupt queued batch quarantined: %s", path.name)
                path.rename(path.with_suffix(".rejected"))
                continue
            response = await api.post(f"{self.api}/api/collector/batches", json=body)
            if response.status_code == 422:
                logger.error("Rejected batch retained for inspection: %s", path.name)
                path.rename(path.with_suffix(".rejected"))
                continue
            response.raise_for_status()
            path.unlink()

    async def enforce(self, controller, command):
        if not self.mitigation:
            return {"status": "failed", "detail": "Collector ALLOW_MITIGATION is disabled"}
        payload = command["payload"]
        switch = str(payload["switch_id"])
        if self.switch_allowlist and switch not in self.switch_allowlist:
            return {"status": "failed", "detail": "Switch is outside this collector's allowlist"}
        if (datetime.now(timezone.utc) - datetime.fromisoformat(command["created_at"])).total_seconds() > 120:
            return {"status": "failed", "detail": "Command expired before execution"}
        match = {
            "eth_type": 2048,
            "ipv4_src": payload["source_ip"],
            "ipv4_dst": payload["destination_ip"],
            "ip_proto": payload["protocol"],
        }
        if payload.get("destination_port") is not None and payload["protocol"] in (6, 17):
            match["tcp_dst" if payload["protocol"] == 6 else "udp_dst"] = payload["destination_port"]
        rule = {
            "dpid": int(switch),
            "cookie": int(command["cookie"]),
            "cookie_mask": 0xFFFFFFFFFFFFFFFF,
            "table_id": 0,
            "priority": 50000,
            "match": match,
        }
        block = command["kind"] == "block"
        if block:
            rule.update({"hard_timeout": 300, "idle_timeout": 0, "actions": []})
        response = await controller.post(
            f"{self.controller}/stats/flowentry/{'add' if block else 'delete_strict'}", json=rule
        )
        response.raise_for_status()
        # REST success alone is not enough: read the actual switch flow table back.
        for _ in range(5):
            await asyncio.sleep(0.3)
            response = await controller.get(f"{self.controller}/stats/flow/{switch}")
            response.raise_for_status()
            entries = response.json().get(switch, [])
            present = any(
                int(entry.get("cookie", 0)) == int(command["cookie"])
                and entry.get("priority") == 50000
                and not entry.get("actions")
                for entry in entries
            )
            if present == block:
                return {
                    "status": "enforced" if block else "revoked",
                    "detail": "Verified in switch flow statistics"
                    if block
                    else "Verified rule absent from switch",
                }
        return {"status": "failed", "detail": "Controller accepted request but switch verification timed out"}

    async def run(self):
        headers = {"Authorization": f"Bearer {self.token}"}
        async with (
            httpx.AsyncClient(timeout=12, headers=headers) as api,
            httpx.AsyncClient(timeout=10) as controller,
        ):
            while True:
                started = time.monotonic()
                switches, flows, status, topology = [], [], "connected", {}
                try:
                    response = await controller.get(f"{self.controller}/stats/switches")
                    response.raise_for_status()
                    switches = [
                        str(s)
                        for s in response.json()
                        if not self.switch_allowlist or str(s) in self.switch_allowlist
                    ]
                    discovery = await controller.get(f"{self.controller}/sentinel/topology")
                    if discovery.status_code == 200:
                        topology = discovery.json()
                    stamp = datetime.now(timezone.utc).isoformat()
                    for switch in switches:
                        response = await controller.get(f"{self.controller}/stats/flow/{switch}")
                        response.raise_for_status()
                        for entry in response.json().get(switch, []):
                            flow = self.tracker.window(switch, entry, started, stamp)
                            if flow:
                                flows.append(flow)
                except (httpx.HTTPError, ValueError, KeyError):
                    logger.exception("Controller poll failed")
                    status = "unreachable"
                self.tracker.prune(started)
                try:
                    for offset in range(0, max(1, len(flows)), 1000):
                        self.persist(
                            {
                                "batch_id": str(uuid4()),
                                "captured_at": datetime.now(timezone.utc).isoformat(),
                                "collector_id": self.collector_id,
                                "source_type": self.source_type,
                                "switches": switches,
                                "controller_status": status,
                                "version": "1.1.0",
                                "topology": topology,
                                "flows": flows[offset : offset + 1000],
                            }
                        )
                    await self.flush(api)
                    if status == "connected":
                        response = await api.get(f"{self.api}/api/collector/{self.collector_id}/commands")
                        response.raise_for_status()
                        for command in response.json():
                            try:
                                result = await self.enforce(controller, command)
                            except (httpx.HTTPError, ValueError, KeyError):
                                logger.exception("Mitigation command failed")
                                result = {
                                    "status": "failed",
                                    "detail": "Controller communication or validation failed",
                                }
                            response = await api.post(
                                f"{self.api}/api/collector/{self.collector_id}/commands/{command['id']}/result",
                                json=result,
                            )
                            response.raise_for_status()
                    logger.info(
                        "poll switches=%d flow_windows=%d controller=%s", len(switches), len(flows), status
                    )
                except (httpx.HTTPError, RuntimeError):
                    logger.exception("API delivery failed; queued batches retained")
                await asyncio.sleep(max(0.1, self.interval - (time.monotonic() - started)))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(Agent().run())
