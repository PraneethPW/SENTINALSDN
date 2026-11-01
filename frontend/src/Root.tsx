import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Landing, { Brand } from "./Landing";
import AuthPortal from "./AuthPortal";
import type { AuthResult } from "./AuthPortal";
import { request } from "./api";
import type { User } from "./api";
import { readSession, writeSession } from "./session";
const Console = lazy(() => import("./App"));
let handoff: { key: string; promise: Promise<AuthResult> } | null = null;
function completeGoogle(code: string, verifier: string) {
  const key = code + verifier;
  if (!handoff || handoff.key !== key)
    handoff = {
      key,
      promise: request<AuthResult>("/api/auth/google/exchange", null, {
        method: "POST",
        body: JSON.stringify({ code, verifier }),
      }),
    };
  return handoff.promise;
}
function Callback() {
  const [error, setError] = useState("");
  useEffect(() => {
    const code = new URLSearchParams(location.hash.slice(1)).get("code");
    let verifier: string | null = null;
    try {
      verifier = sessionStorage.getItem("sentinel.google.verifier");
    } catch {
      /* Missing storage produces a visible recovery route. */
    }
    if (!code || !verifier) {
      setError(
        "The sign-in request is missing or expired. Start Google sign-in again.",
      );
      return;
    }
    let active = true;
    void completeGoogle(code, verifier)
      .then((result) => {
        if (!active) return;
        sessionStorage.removeItem("sentinel.google.verifier");
        if (!writeSession(result.token))
          throw new Error(
            "Allow browser session storage to finish signing in.",
          );
        location.replace(result.user.approved === false ? "/account" : "/app");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <EntryShell>
      <p className="lp-kicker">SECURE HANDOFF</p>
      <h1>{error ? "Let’s try that again." : "Completing your sign-in."}</h1>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <a href="/auth/sign-in" className="lp-button">
            Return to sign in
            <ArrowRight size={17} />
          </a>
        </>
      ) : (
        <LoaderCircle className="spin" size={28} />
      )}
    </EntryShell>
  );
}
function EntryShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="entry-page">
      <Brand />
      <div className="entry-card">{children}</div>
      <a className="lp-text-link" href="/">
        <ArrowLeft size={15} />
        Back to Sentinel
      </a>
    </main>
  );
}
function WorkspaceGate() {
  const [user, setUser] = useState<User | null>(null),
    [error, setError] = useState(""),
    [checking, setChecking] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (user?.approved && location.pathname === "/account")
      location.replace("/app");
  }, [user?.approved]);
  useEffect(() => {
    const token = readSession();
    if (!token) {
      location.replace("/auth/sign-in");
      return;
    }
    let active = true;
    const c = new AbortController();
    async function check() {
      try {
        const me = await request<User>("/api/auth/me", token, {
          signal: c.signal,
        });
        if (active) {
          setUser(me);
          setError("");
        }
      } catch (e) {
        if (active && e instanceof Error && e.name !== "AbortError") {
          setError(e.message);
          setUser(null);
        }
      } finally {
        if (active) setChecking(false);
      }
    }
    void check();
    const timer = setInterval(() => void check(), 10000);
    const session = () => {
      if (!readSession()) location.replace("/auth/sign-in");
    };
    window.addEventListener("sentinel:session", session);
    return () => {
      active = false;
      c.abort();
      clearInterval(timer);
      window.removeEventListener("sentinel:session", session);
    };
  }, [attempt]);
  if (checking && !user)
    return (
      <EntryShell>
        <LoaderCircle size={26} className="spin" />
        <h1>Connecting your workspace.</h1>
        <p>Checking your account and access.</p>
      </EntryShell>
    );
  if (error)
    return (
      <EntryShell>
        <LockKeyhole size={32} />
        <h1>Reconnect to your account.</h1>
        <p role="alert">{error}</p>
        <a href="/auth/sign-in" className="lp-button">
          Sign in
          <ArrowRight size={17} />
        </a>
      </EntryShell>
    );
  if (user?.approved === false)
    return (
      <EntryShell>
        <span className="entry-shield">
          <ShieldCheck size={37} strokeWidth={1} />
        </span>
        <p className="lp-kicker">WORKSPACE ACCESS / RESTRICTED</p>
        <h1>
          Access needs review,
          <br />
          <em>{user.display_name || "welcome"}.</em>
        </h1>
        <p>
          Your account exists, but access to this team workspace is currently
          restricted. Contact the administrator who manages this workspace.
        </p>
        <div className="entry-checks">
          <span>
            <Check size={15} />
            Account recognized
          </span>
          <span>
            <Check size={15} />
            Signed in as {user.email}
          </span>
          <span>
            <LoaderCircle size={15} />
            Awaiting workspace approval
          </span>
        </div>
        <p className="entry-hint">
          This page checks your access every ten seconds. Your administrator can
          approve your account in System settings.
        </p>
        <button className="lp-button" onClick={() => setAttempt((x) => x + 1)}>
          Check access
          <RefreshCw size={16} />
        </button>
        <button
          className="entry-signout"
          onClick={() => {
            const token = readSession();
            if (token)
              void request("/api/auth/logout", token, { method: "POST" }).catch(
                () => {},
              );
            writeSession(null);
            location.replace("/auth/sign-in");
          }}
        >
          Sign out
        </button>
      </EntryShell>
    );
  if (!user) return null;
  return (
    <Suspense
      fallback={
        <EntryShell>
          <LoaderCircle className="spin" size={26} />
          <h1>Opening your console.</h1>
        </EntryShell>
      }
    >
      <Console />
    </Suspense>
  );
}
function Privacy() {
  return (
    <main className="privacy-page lp-wrap">
      <Brand />
      <p className="lp-kicker">PRIVACY / 1 NOVEMBER 2026</p>
      <h1>
        Your data.
        <br />
        <em>In perspective.</em>
      </h1>
      <section>
        <h2>Account identity</h2>
        <p>
          Email registration stores your name, email address, and an Argon2
          password hash. Google sign-in uses your Google account identifier,
          verified email and profile name. Google tokens are used to verify
          sign-in and are not saved as ongoing access credentials.
        </p>
        <h2>Workspace access</h2>
        <p>
          New registrations create a private workspace owned by the registrant.
          Existing research-lab memberships stay separate. Team accounts have
          scoped roles; collectors authenticate with a workspace-specific key. A
          workspace never inherits another user’s operational measurements.
        </p>
        <h2>Network measurements</h2>
        <p>
          Collectors store flow timestamps, endpoint addresses, counters,
          topology, model verdicts, and investigation history in PostgreSQL.
          Operational measurements are available only to approved signed-in
          workspace members. Raw public training data is not used as live
          traffic.
        </p>
        <h2>Optional AI</h2>
        <p>
          When an operator requests analysis, counts, protocol and model
          evidence are sent to OpenRouter. Endpoint addresses, account identity
          and investigation notes are excluded from the analysis payload. AI
          never installs a rule.
        </p>
        <h2>Browser storage and retention</h2>
        <p>
          Your opaque session token is held in this tab’s session storage. The
          Google flow uses temporary state cookies and a short-lived browser
          verifier. Expired sessions and OAuth requests are cleaned
          automatically. Flow retention defaults to seven days; audit and
          investigation history are retained separately.
        </p>
        <h2>Account requests</h2>
        <p>
          Contact the administrator who manages your workspace for account
          access, corrections or deletion requests. The application does not
          sell account or network data.
        </p>
      </section>
      <a className="lp-text-link" href="/">
        <ArrowLeft size={15} />
        Back to Sentinel
      </a>
    </main>
  );
}
export default function Root() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  if (path === "/auth/sign-in") return <AuthPortal />;
  if (path === "/auth/register") return <AuthPortal register />;
  if (path === "/auth/callback") return <Callback />;
  if (path === "/app" || path === "/account") return <WorkspaceGate />;
  if (path === "/privacy") return <Privacy />;
  return <Landing />;
}
