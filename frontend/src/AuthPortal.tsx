import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { request } from "./api";
import type { User } from "./api";
import { writeSession } from "./session";
import { Brand } from "./components/PublicHeader";
import DetectionLab from "./DetectionLab";
import BenchmarkReference from "./components/BenchmarkReference";
import { CinematicBackdrop, CinematicChapter, MotionToggle } from "./components/CinematicScene";
import { useMotionPreference } from "./motionPreference";
import NetworkHologram from "./components/NetworkHologram";
export type AuthResult = { token: string; user: User };
const messages: Record<string, string> = {
  registration_closed: "New account registration is currently closed.",
  account_unavailable:
    "This account is unavailable. Contact your workspace administrator.",
};
export default function AuthPortal({
  register = false,
}: {
  register?: boolean;
}) {
  const { reduced } = useMotionPreference();
  const [config, setConfig] = useState<{ registration: boolean } | null>(null);
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
    if (!register) return;
    const controller = new AbortController();
    void request<{ registration: boolean }>("/api/auth/config", null, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
    }).then(setConfig).catch(() => {
      // Submission reports connectivity errors; the form remains available to retry.
    });
    return () => controller.abort();
  }, [register]);
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
    <div className={`cinematic-page cinematic-auth${reduced ? " motion-off" : ""}`}>
      <CinematicBackdrop scene="silicon" />
      <main className={`auth-page${register ? "" : " auth-with-benchmark"}`}>
        <div className="auth-main">
          <header>
            <Brand />
            <div className="research-nav-actions">
              {register ? (
                <a href="/" className="auth-back"><ArrowLeft size={15} /> Back to Sentinel</a>
              ) : (
                <a href="#benchmark" className="research-text-link auth-benchmark-link">Detection Lab <ArrowRight size={14} /></a>
              )}
              <MotionToggle />
            </div>
          </header>
          <section className="auth-form-wrap">
            <p className="cockpit-kicker"><LockKeyhole size={14} /> SECURE WORKSPACE ACCESS</p>
            <h1>{register ? "Create your workspace." : "Sign in to Sentinel."}</h1>
            <p className="auth-intro">
              {register
                ? "Create your private workspace, then start your live lab in one click."
                : "Sign in to see live flows and alerts from your workspace. The benchmark is public."}
            </p>
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
                ? "Your workspace starts empty. Start your live lab to see real measurements."
                : "Your session is private to this browser tab."}{" "}
              <a href="/privacy">Privacy details</a>
            </p>
          </section>
        </div>
        <div className="auth-side">
          <section className="auth-visual" aria-label="Your network command center">
            <NetworkHologram />
            <div><p className="cockpit-kicker">YOUR NETWORK. IN FOCUS.</p><h2>A clear view.<br /><em>A stronger defense.</em></h2><p>Private workspaces. Measured signals. Evidence behind every verdict.</p></div>
          </section>
          {register ? (
            <CinematicChapter scene="rack" className="auth-register-reference benchmark-embed">
              <BenchmarkReference action={<a href="/lab#benchmark" className="research-button ghost">Open Detection Lab</a>} />
            </CinematicChapter>
          ) : <DetectionLab placement="sign-in" />}
        </div>
      </main>
    </div>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
      <path d="M3 13 13 3M3 3h10v10" fill="none" stroke="currentColor" />
    </svg>
  );
}
