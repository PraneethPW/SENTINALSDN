"""Host reconciler tests exercise stale requests and ownership boundaries."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4
import pytest

spec = importlib.util.spec_from_file_location("lab_host", Path("lab/host.py"))
host_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_module)


def test_host_never_removes_an_unowned_container():
    host = host_module.Host({"sources": []})
    with pytest.raises(RuntimeError, match="unowned"):
        host.remove({"Config": {"Labels": {}}, "Id": "other"})


def test_credentials_are_not_command_arguments_and_stale_start_is_removed(monkeypatch):
    source = {"url": "https://api.example.test", "token": "host-secret"}
    host = host_module.Host({"sources": [source]})
    run = str(uuid4())
    workspace = str(uuid4())
    calls = []
    claim = {
        "collector_token": "private-run-secret",
        "collector_id": "lab-" + run.replace("-", ""),
        "workspace_id": workspace,
        "expires_at": "2026-11-01T20:00:00Z",
    }
    monkeypatch.setattr(host_module, "api", lambda *args: claim)
    monkeypatch.setattr(
        host, "command", lambda args, **kwargs: calls.append((args, kwargs)) or SimpleNamespace(returncode=0)
    )
    monkeypatch.setattr(host, "report", lambda *args: (_ for _ in ()).throw(host_module.ApiError(409)))
    row = {"Config": {"Labels": {host_module.OWNED: "1"}}, "Id": "owned-container"}
    monkeypatch.setattr(host, "inventory", lambda: {run: row})
    with pytest.raises(host_module.ApiError):
        host.start(source, {"id": run, "revision": 1})
    assert calls[0][1]["env"]["COLLECTOR_TOKEN"] == "private-run-secret"
    assert all("private-run-secret" not in arg for args, _ in calls for arg in args)
    assert calls[-1][0] == ["rm", "-f", "owned-container"]


def test_docker_failure_reports_unavailability_without_starting_any_container(monkeypatch):
    source = {"url": "https://api.example.test", "token": "host-secret"}
    host = host_module.Host({"sources": [source], "docker_context": "test"})
    monkeypatch.setattr(host, "inventory", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    calls = []
    monkeypatch.setattr(
        host_module, "api", lambda source, path, body: calls.append((path, body)) or {"jobs": []}
    )
    host.tick()
    assert calls == [
        (
            "/poll",
            {
                "ready": False,
                "capacity": 2,
                "external_busy": 0,
                "reason": "docker_unavailable",
                "version": "1.4.0",
            },
        )
    ]
