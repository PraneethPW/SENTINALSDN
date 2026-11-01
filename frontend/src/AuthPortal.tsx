import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { API, request } from "./api";
import type { User } from "./api";
import { writeSession } from "./session";
import { Brand } from "./Landing";
export type AuthResult = { token: string; user: User };
const messages: Record<string, string> = {
  google_cancelled: "Google sign-in was cancelled. You can try again.",
  google_unavailable:
    "Google could not verify your sign-in. Try again or use email.",
  existing_email:
    "This email already has a password account. Sign in with your password, then connect Google in System settings.",
  google_link_mismatch:
    "Choose the Google account with the same email as your signed-in Sentinel account.",
  google_link_conflict:
    "This Google identity is already connected to another account.",
  registration_closed: "New account registration is currently closed.",
  account_unavailable:
    "This account is unavailable. Contact your workspace administrator.",
};
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.85 46.98 24.55z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59A14.41 14.41 0 019.76 24c0-1.59.27-3.13.77-4.59l-7.98-6.19A23.87 23.87 0 000 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
export async function beginGoogle(linkTicket?: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  sessionStorage.setItem("sentinel.google.verifier", verifier);
  const hashed = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const value = btoa(String.fromCharCode(...new Uint8Array(hashed)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const url = new URL(`${API}/api/auth/google/start`, location.origin);
  url.searchParams.set("origin", location.origin);
  url.searchParams.set("handoff_challenge", value);
  if (linkTicket) url.searchParams.set("link_ticket", linkTicket);
  location.assign(url);
}
export default function AuthPortal({
  register = false,
}: {
  register?: boolean;
}) {
  const [config, setConfig] = useState<{
      registration: boolean;
      google: boolean;
    } | null>(null),
    [configError, setConfigError] = useState(false);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(
      () =>
        messages[new URLSearchParams(location.search).get("error") ?? ""] ?? "",
    );
  useEffect(() => {
    const c = new AbortController();
    void request<{ registration: boolean; google: boolean }>(
      "/api/auth/config",
      null,
      { signal: c.signal },
    )
      .then(setConfig)
      .catch((e) => {
        if (e.name !== "AbortError") setConfigError(true);
      });
    return () => c.abort();
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (register && password !== confirm) {
      setError("Your passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await request<AuthResult>(
        register ? "/api/auth/register" : "/api/auth/login",
        null,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            ...(register ? { display_name: name } : {}),
          }),
        },
      );
      if (!writeSession(result.token))
        throw new Error("Allow browser session storage to finish signing in.");
      location.assign(result.user.approved === false ? "/account" : "/app");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to connect. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-main">
        <header>
          <Brand />
          <a href="/" className="auth-back">
            <ArrowLeft size={15} />
            Back to Sentinel
          </a>
        </header>
        <section className="auth-form-wrap">
          <p className="lp-kicker">
            {register ? "YOUR NEXT PERSPECTIVE" : "WELCOME BACK"}
          </p>
          <h1>
            {register ? (
              <>
                Clarity starts
                <br />
                with <em>you.</em>
              </>
            ) : (
              <>
                Back to
                <br />
                <em>the signal.</em>
              </>
            )}
          </h1>
          <p className="auth-intro">
            {register
              ? "Create your account, then request access to the network workspace."
              : "Sign in to your Sentinel account and continue where you left off."}
          </p>
          <button
            className="auth-google"
            disabled={busy || !config?.google}
            onClick={() => {
              setBusy(true);
              void beginGoogle().catch(() => {
                setError(
                  "Google sign-in needs browser storage and a secure connection. Please try email.",
                );
                setBusy(false);
              });
            }}
          >
            <GoogleMark />
            Continue with Google
          </button>
          {!config?.google && config ? (
            <p className="auth-provider-note">
              Google sign-in is awaiting setup. Email access is available below.
            </p>
          ) : null}
          {configError ? (
            <p className="auth-provider-note" role="status">
              Unable to check Google availability. Email sign-in can still be
              attempted.
            </p>
          ) : null}
          <div className="auth-divider">
            <span />
            {register ? "OR CREATE WITH EMAIL" : "OR SIGN IN WITH EMAIL"}
            <span />
          </div>
          <form onSubmit={submit} className="auth-form">
            {register ? (
              <label htmlFor="full-name">
                Your name
                <input
                  id="full-name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={80}
                  placeholder="How should we call you?"
                  disabled={busy}
                />
              </label>
            ) : null}
            <label htmlFor="auth-email">
              Email address
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                placeholder="you@example.com"
                disabled={busy}
              />
            </label>
            <label htmlFor="auth-password">
              Password
              <div className="auth-password">
                <input
                  id="auth-password"
                  type={visible ? "text" : "password"}
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={register ? 14 : 1}
                  maxLength={256}
                  placeholder={
                    register ? "At least 14 characters" : "Enter your password"
                  }
                  disabled={busy}
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {register ? (
              <>
                <p className="auth-password-hint">
                  Use a unique passphrase of at least 14 characters.
                </p>
                <label htmlFor="auth-confirm">
                  Confirm password
                  <input
                    id="auth-confirm"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    minLength={14}
                    maxLength={256}
                    placeholder="Enter your password again"
                    disabled={busy}
                  />
                </label>
              </>
            ) : null}
            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="lp-button auth-submit"
              disabled={busy || (register && config?.registration === false)}
            >
              {busy ? <LoaderCircle size={18} className="spin" /> : null}
              {busy
                ? "Connecting securely…"
                : register
                  ? "Create account"
                  : "Sign in"}
              {!busy ? <ArrowRight size={17} /> : null}
            </button>
            {register && config?.registration === false ? (
              <p role="status" className="auth-error">
                Registration is currently closed. Contact your administrator.
              </p>
            ) : null}
          </form>
          <p className="auth-switch">
            {register ? "Already have an account?" : "New to Sentinel?"}{" "}
            <a href={register ? "/auth/sign-in" : "/auth/register"}>
              {register ? "Sign in" : "Create an account"}
              <ArrowUpRightIcon />
            </a>
          </p>
          <p className="auth-privacy">
            <LockKeyhole size={12} />
            {register
              ? "Registration does not grant access to network data."
              : "Your session is private to this browser tab."}{" "}
            <a href="/privacy">Privacy details</a>
          </p>
        </section>
        <footer>
          OBSERVE. UNDERSTAND. DEFEND.<span>SENTINEL / SDN</span>
        </footer>
      </div>
      <aside className="auth-art">
        <div className="auth-art-grid" />
        <div className="auth-art-orbit">
          <i />
          <i />
          <i />
          <ShieldCheck size={90} strokeWidth={0.55} />
        </div>
        <span className="lp-kicker">A SYSTEM BUILT ON EVIDENCE</span>
        <h2>
          One workspace.
          <br />A clearer
          <br />
          <em>point of view.</em>
        </h2>
        <p>
          Measured network behavior. Traceable detections. Thoughtful human
          response.
        </p>
        <div className="auth-art-assurance">
          <Check size={14} />
          Workspace approval protects operational telemetry.
        </div>
        <span className="auth-art-label">SIGNAL INTEGRITY / HUMAN INTENT</span>
      </aside>
    </main>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
      <path d="M3 13 13 3M3 3h10v10" fill="none" stroke="currentColor" />
    </svg>
  );
}
