"""Public entry boundaries against a real isolated PostgreSQL database."""

import hashlib
import secrets
from urllib.parse import urlparse, parse_qs
import psycopg
import pytest
from app.config import settings
from app.public_auth import challenge
from test_api import client as client, auth, TEST_URL


def signup(client, **extra):
    return client.post(
        "/api/auth/register",
        json={
            "display_name": "Test Investigator",
            "email": "new@integration.test",
            "password": "A-long-private-passphrase!",
            **extra,
        },
    )


def test_registration_creates_private_workspace_without_exposing_lab(client):
    from test_api import batch, TOKEN

    client.post("/api/collector/batches", json=batch(), headers={"Authorization": "Bearer " + TOKEN})
    r = signup(client, role="admin", approved=True)
    assert r.status_code == 201
    data = r.json()
    assert data["user"]["role"] == "admin" and data["user"]["approved"] is True
    assert data["user"]["workspace_id"] != "00000000-0000-0000-0000-000000000001"
    h = {"Authorization": "Bearer " + data["token"]}
    mine = client.get("/api/snapshot", headers=h).json()
    assert mine["flows"] == [] and mine["collectors"] == []
    assert mine["workspace"]["kind"] == "private"
    assert mine["workspace"]["has_measurements"] is False
    assert len(client.get("/api/users", headers=h).json()) == 1
    assert client.post("/api/auth/ws-ticket", headers=h).status_code == 200
    assert signup(client).status_code == 409
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_lab_admin_cannot_approve_or_change_a_private_workspace_owner(client):
    r = signup(client).json()
    h = {"Authorization": "Bearer " + r["token"]}
    assert (
        client.patch(
            "/api/users/" + r["user"]["id"],
            headers=auth(client),
            json={"active": True, "role": "viewer", "approved": True},
        ).status_code
        == 404
    )
    assert (
        client.patch(
            "/api/users/" + r["user"]["id"],
            headers=h,
            json={"active": True, "role": "viewer", "approved": True},
        ).status_code
        == 409
    )
    assert client.get("/api/auth/me", headers=h).json()["role"] == "admin"


@pytest.mark.parametrize(
    "extra", [{"display_name": "  "}, {"email": "a@@example.com"}, {"password": "short"}]
)
def test_registration_validation(client, extra):
    assert signup(client, **extra).status_code == 422


def test_configuration_absent_model_and_disabled_signup(client, monkeypatch):
    assert client.get("/api/auth/config").json()["google"] is False
    r = client.get("/api/public/overview")
    assert r.status_code == 200 and r.json()["precision"] is None
    assert (
        client.get(
            "/api/auth/google/start",
            params={"origin": "http://localhost:5173", "handoff_challenge": "x" * 43},
        ).status_code
        == 503
    )
    monkeypatch.setenv("REGISTRATION_ENABLED", "false")
    settings.cache_clear()
    assert signup(client).status_code == 403


def test_google_state_cookie_and_return_origin_are_enforced(client, monkeypatch):
    for k, v in {
        "GOOGLE_CLIENT_ID": "test-client",
        "GOOGLE_CLIENT_SECRET": "test-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:5180/api/auth/google/callback",
    }.items():
        monkeypatch.setenv(k, v)
    settings.cache_clear()
    params = {"origin": "https://attacker.invalid", "handoff_challenge": "a" * 43}
    assert client.get("/api/auth/google/start", params=params).status_code == 400
    params["origin"] = "http://localhost:5173"
    r = client.get("/api/auth/google/start", params=params, follow_redirects=False)
    assert r.status_code == 303
    query = parse_qs(urlparse(r.headers["location"]).query)
    assert query["scope"] == ["openid email profile"] and query["code_challenge_method"] == ["S256"]
    assert "HttpOnly" in r.headers["set-cookie"] and "SameSite=lax" in r.headers["set-cookie"]
    assert (
        client.get("/api/auth/google/callback", params={"state": "wrong", "code": "untrusted"}).status_code
        == 400
    )
    cancelled = client.get(
        "/api/auth/google/callback",
        params={"state": query["state"][0], "error": "access_denied"},
        follow_redirects=False,
    )
    assert cancelled.status_code == 303 and cancelled.headers["location"].endswith(
        "/auth/sign-in?error=google_cancelled"
    )
    assert (
        client.get(
            "/api/auth/google/callback", params={"state": query["state"][0], "code": "replay"}
        ).status_code
        == 400
    )


def test_google_handoff_is_bound_to_browser_and_one_use(client):
    r = signup(client).json()
    verifier = secrets.token_urlsafe(48)
    code = secrets.token_urlsafe(48)
    with psycopg.connect(TEST_URL) as conn:
        conn.execute(
            "INSERT INTO sentinel.oauth_handoffs(code_hash,user_id,challenge,expires_at) VALUES (%s,%s,%s,now()+interval '1 minute')",
            (hashlib.sha256(code.encode()).hexdigest(), r["user"]["id"], challenge(verifier)),
        )
    assert (
        client.post("/api/auth/google/exchange", json={"code": code, "verifier": "a" * 64}).status_code == 401
    )
    good = client.post("/api/auth/google/exchange", json={"code": code, "verifier": verifier})
    assert good.status_code == 200
    assert good.json()["user"]["approved"] is True
    assert (
        client.post("/api/auth/google/exchange", json={"code": code, "verifier": verifier}).status_code == 401
    )


def test_google_only_account_password_attempt_returns_401(client):
    with psycopg.connect(TEST_URL) as conn:
        conn.execute(
            "UPDATE sentinel.users SET password_hash='!google-only',password_enabled=false WHERE email='viewer@integration.test'"
        )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "viewer@integration.test", "password": "Any-passphrase-long-enough"},
        ).status_code
        == 401
    )


def test_registration_entry_rate_limit(client):
    with psycopg.connect(TEST_URL) as conn:
        identity = "entry:" + hashlib.sha256(b"testclient").hexdigest()
        conn.execute(
            "INSERT INTO sentinel.login_attempts(identity) SELECT %s FROM generate_series(1,30)", (identity,)
        )
    assert signup(client).status_code == 429


@pytest.fixture
def google_provider(monkeypatch):
    """Provider boundary fixture only; no fixture is ever used by a product server."""
    import httpx
    import app.public_auth as module

    for key, value in {
        "GOOGLE_CLIENT_ID": "test-client",
        "GOOGLE_CLIENT_SECRET": "test-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:5180/api/auth/google/callback",
    }.items():
        monkeypatch.setenv(key, value)
    settings.cache_clear()
    original = httpx.AsyncClient

    class TokenClient(original):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = httpx.MockTransport(
                lambda req: httpx.Response(200, json={"id_token": "isolated-provider-fixture"})
            )
            super().__init__(*args, **kwargs)

    claims = {
        "sub": "isolated-google-subject",
        "email": "google@integration.test",
        "email_verified": True,
        "name": "Integration Google User",
        "nonce": "",
    }
    monkeypatch.setattr(module.httpx, "AsyncClient", TokenClient)
    monkeypatch.setattr(module, "verify_google", lambda token, audience: dict(claims))
    return claims


def start_google(client, claims, **extra):
    verifier = secrets.token_urlsafe(48)
    r = client.get(
        "/api/auth/google/start",
        params={"origin": "http://localhost:5173", "handoff_challenge": challenge(verifier), **extra},
        follow_redirects=False,
    )
    assert r.status_code == 303, r.text
    query = parse_qs(urlparse(r.headers["location"]).query)
    claims["nonce"] = query["nonce"][0]
    return verifier, query["state"][0]


def test_verified_google_callback_creates_private_workspace_and_bound_handoff(client, google_provider):
    verifier, state = start_google(client, google_provider)
    r = client.get(
        "/api/auth/google/callback",
        params={"state": state, "code": "isolated-auth-code"},
        follow_redirects=False,
    )
    assert r.status_code == 303
    code = parse_qs(urlparse(r.headers["location"]).fragment)["code"][0]
    result = client.post("/api/auth/google/exchange", json={"code": code, "verifier": verifier})
    assert result.status_code == 200
    assert result.json()["user"]["approved"] is True and result.json()["user"]["password_enabled"] is False
    assert result.json()["user"]["role"] == "admin"
    assert (
        client.get("/api/snapshot", headers={"Authorization": "Bearer " + result.json()["token"]}).status_code
        == 200
    )


def test_google_nonce_mismatch_is_rejected(client, google_provider):
    _, state = start_google(client, google_provider)
    google_provider["nonce"] = "another-browser"
    result = client.get(
        "/api/auth/google/callback",
        params={"state": state, "code": "isolated-auth-code"},
        follow_redirects=False,
    )
    assert result.headers["location"].endswith("error=google_unavailable")


def test_google_cannot_auto_link_email_but_can_link_authenticated_matching_account(client, google_provider):
    google_provider["email"] = "admin@integration.test"
    _, state = start_google(client, google_provider)
    conflict = client.get(
        "/api/auth/google/callback",
        params={"state": state, "code": "isolated-auth-code"},
        follow_redirects=False,
    )
    assert conflict.headers["location"].endswith("error=existing_email")
    header = auth(client)
    assert client.get("/api/auth/connections", headers=header).json()["google"] is False
    ticket = client.post("/api/auth/google/link-ticket", headers=header).json()["ticket"]
    verifier, state = start_google(client, google_provider, link_ticket=ticket)
    linked = client.get(
        "/api/auth/google/callback",
        params={"state": state, "code": "isolated-auth-code"},
        follow_redirects=False,
    )
    code = parse_qs(urlparse(linked.headers["location"]).fragment)["code"][0]
    result = client.post("/api/auth/google/exchange", json={"code": code, "verifier": verifier})
    assert result.json()["user"]["role"] == "admin" and result.json()["user"]["approved"] is True
    assert client.get("/api/auth/connections", headers=header).json()["google"] is True
    assert (
        client.get(
            "/api/auth/google/start",
            params={"origin": "http://localhost:5173", "handoff_challenge": "a" * 43, "link_ticket": ticket},
        ).status_code
        == 401
    )
