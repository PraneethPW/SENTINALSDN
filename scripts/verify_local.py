"""Exercise the actual isolated local stack; never reads or writes the deployed database."""

import asyncio, json, secrets, time, statistics
from pathlib import Path
import httpx, websockets

root = Path(__file__).resolve().parents[1]
env = dict(
    s.split("=", 1)
    for s in (root / ".env.local-stack").read_text().splitlines()
    if "=" in s
)


async def verify():
    async with httpx.AsyncClient(base_url="http://localhost:8100", timeout=30) as c:
        login = await c.post(
            "/api/auth/login",
            json={
                "email": env["LOCAL_ADMIN_EMAIL"],
                "password": env["LOCAL_ADMIN_PASSWORD"],
            },
        )
        login.raise_for_status()
        token = login.json()["token"]
        headers = {"Authorization": "Bearer " + token}
        assert (await c.get("/health/ready")).json()["ready"]
        data = (await c.get("/api/snapshot", headers=headers)).json()
        assert len(data["collectors"]) == 1 and data["collectors"][0]["online"]
        assert len(data["collectors"][0]["switches"]) == 3
        assert data["collectors"][0]["topology"]["available"]
        assert len(data["collectors"][0]["topology"]["hosts"]) == 3
        assert data["model"]["metadata"]["release_gate"]["passed"]
        assert data["model"]["ready"]
        assert (await c.get("/api/flows?limit=5", headers=headers)).json()["items"]
        assert (
            await c.get("/api/flows/export?minutes=60", headers=headers)
        ).status_code == 200
        timings = []

        async def read():
            start = time.monotonic()
            r = await c.get("/api/snapshot", headers=headers)
            r.raise_for_status()
            timings.append((time.monotonic() - start) * 1000)

        await asyncio.gather(*[read() for _ in range(20)])

        async def subscribe():
            ticket = (await c.post("/api/auth/ws-ticket", headers=headers)).json()[
                "ticket"
            ]
            async with websockets.connect(
                "ws://localhost:8100/api/live?ticket=" + ticket,
                origin="http://localhost:5180",
            ) as ws:
                frame = json.loads(await asyncio.wait_for(ws.recv(), 10))
                assert frame["model"]["ready"]
                return frame["revision"]

        revisions = await asyncio.gather(*[subscribe() for _ in range(20)])
        private = root / "backend/work/local-qa.json"
        accounts = json.loads(private.read_text()) if private.exists() else {}
        for role in ["viewer", "operator"]:
            email = f"qa-{role}@sentinel.local"
            password = secrets.token_urlsafe(32)
            existing = next(
                (
                    u
                    for u in (await c.get("/api/users", headers=headers)).json()
                    if u["email"] == email
                ),
                None,
            )
            if existing and role not in accounts:
                continue
            if not existing:
                r = await c.post(
                    "/api/users",
                    headers=headers,
                    json={"email": email, "password": password, "role": role},
                )
                r.raise_for_status()
                accounts[role] = {
                    "id": r.json()["id"],
                    "email": email,
                    "password": password,
                }
            email, password = accounts[role]["email"], accounts[role]["password"]
            logged = await c.post(
                "/api/auth/login", json={"email": email, "password": password}
            )
            logged.raise_for_status()
            h = {"Authorization": "Bearer " + logged.json()["token"]}
            assert (await c.get("/api/flows", headers=h)).status_code == 200
            assert (
                await c.post(
                    "/api/users",
                    headers=h,
                    json={
                        "email": "forbidden@example.test",
                        "password": "Private-test-password!",
                        "role": "admin",
                    },
                )
            ).status_code == 403
        private = root / "backend/work/local-qa.json"
        private.write_text(json.dumps(accounts))
        private.chmod(0o600)
        result = {
            "real_local_switches": 3,
            "hosts": 3,
            "concurrent_http_reads": 20,
            "http_p95_ms": round(sorted(timings)[18], 1),
            "concurrent_authenticated_websockets": len(revisions),
            "model": data["model"]["metadata"]["version"],
            "accounts_exercised": list(accounts),
            "database": "local Docker PostgreSQL; no deployed service used",
        }
        (root / "backend/work/local-verification.json").write_text(
            json.dumps(result, indent=2)
        )
        print(json.dumps(result, indent=2))


asyncio.run(verify())
