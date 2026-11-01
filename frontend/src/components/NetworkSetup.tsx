import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  Download,
  KeyRound,
  LoaderCircle,
  Network,
  Radio,
  ShieldCheck,
  Terminal,
  Unplug,
} from "lucide-react";
import { API, request, time } from "../api";
import type { Snapshot, User } from "../api";

export default function NetworkSetup({
  token,
  user,
  data,
  refresh,
}: {
  token: string;
  user: User;
  data: Snapshot;
  refresh: () => Promise<void>;
}) {
  const workspace = data.workspace;
  const [name, setName] = useState(workspace?.name ?? ""),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState(""),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    setName(workspace?.name ?? "");
  }, [workspace?.name]);
  const online = data.collectors.filter((c) => c.online);
  const connected = online.some((c) => c.controller_status === "connected");
  const key = workspace?.collector_key;
  const latest = data.collectors
    .map((c) => c.last_seen)
    .sort()
    .at(-1);
  const measured = !!data.summary.last_flow;
  async function run(kind: string, operation: () => Promise<void>) {
    setBusy(kind);
    setMessage("");
    setFailed(false);
    try {
      await operation();
      await refresh();
    } catch (e) {
      setFailed(true);
      setMessage(
        e instanceof Error ? e.message : "The request failed. Please retry.",
      );
    } finally {
      setBusy("");
    }
  }
  async function download() {
    await run("download", async () => {
      const response = await fetch(`${API}/api/workspace/collector-setup`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "Setup could not be downloaded.");
      }
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = "sentinel-network-setup.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Setup downloaded. Extract the ZIP and follow its README. Keep the included .env file private.",
      );
    });
  }
  async function revoke() {
    if (
      !window.confirm(
        "Revoke this workspace’s collector key? Collectors using it will stop sending measurements. You can then download a new setup bundle.",
      )
    )
      return;
    await run("revoke", async () => {
      await request("/api/workspace/collector-key/revoke", token, {
        method: "POST",
      });
      setMessage(
        "Collector key revoked. Existing collectors can no longer upload. Download a new setup to reconnect.",
      );
    });
  }
  async function rename(e: FormEvent) {
    e.preventDefault();
    await run("name", async () => {
      await request("/api/workspace", token, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setMessage("Workspace name saved.");
    });
  }
  return (
    <section
      className="network-setup panel"
      aria-labelledby="network-setup-title"
    >
      <div className="setup-welcome">
        <span className="setup-emblem">
          <Network size={28} strokeWidth={1.2} />
        </span>
        <div>
          <span className="eyebrow">YOUR WORKSPACE / YOUR NETWORK</span>
          <h2 id="network-setup-title">
            {data.collectors.length
              ? "Your network connection."
              : "Your workspace is ready."}
          </h2>
          <p>
            {data.collectors.length
              ? "Follow the source of every measurement and manage your collector connection."
              : "Start with your own network. No sample flows, inherited incidents, or other users’ traffic."}
          </p>
        </div>
      </div>
      {message ? (
        <p
          className={`operation-message ${failed ? "form-error" : ""}`}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}
      {user.role === "admin" ? (
        <form className="setup-name" onSubmit={rename}>
          <label htmlFor="workspace-name">
            Workspace name
            <input
              className="form-input"
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={80}
              required
            />
          </label>
          <button
            className="button secondary"
            disabled={!!busy || name.trim() === workspace?.name}
          >
            {busy === "name" ? (
              <LoaderCircle size={15} className="spin" />
            ) : null}
            Save name
          </button>
        </form>
      ) : (
        <p className="footnote">
          A workspace administrator manages collector credentials. You can
          review connection status below.
        </p>
      )}
      <ol className="setup-progress">
        {[
          {
            done: true,
            title: "Private workspace",
            detail:
              workspace?.kind === "research_lab"
                ? "Existing shared research lab membership"
                : "Created for your account",
          },
          {
            done: !!key || data.collectors.length > 0,
            title: "Collector setup",
            detail: key
              ? "Private setup key created"
              : "Download and start your collector",
          },
          {
            done: connected,
            title: "Controller connected",
            detail: connected
              ? "OpenFlow controller is reporting"
              : online.length
                ? "Collector reached us; controller needs attention"
                : "Waiting for your network",
          },
          {
            done: measured,
            title: "Measured traffic",
            detail: measured
              ? `Latest flow ${time(data.summary.last_flow!)}`
              : "Waiting for the first counter window",
          },
        ].map((step, i) => (
          <li key={step.title} className={step.done ? "complete" : ""}>
            <span>
              {step.done ? <Check size={16} /> : String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="setup-columns">
        <div className="setup-instructions">
          <span className="eyebrow">
            <KeyRound size={14} /> 01 / DOWNLOAD YOUR CONNECTION
          </span>
          <h3>A collector that belongs to this workspace.</h3>
          <p>
            The setup bundle contains a private key and the real collector. It
            can connect an existing Ryu/OS-Ken controller, or start an isolated
            Mininet lab with real switches, hosts, and bounded traffic.
          </p>
          {workspace?.kind === "research_lab" ? (
            <p className="operation-message">
              This is the original Mac research lab. Its server-managed
              collector is separate from downloadable workspace keys.
            </p>
          ) : null}
          {user.role === "admin" ? (
            <>
              <button
                className="button primary"
                onClick={() => void download()}
                disabled={!!busy || !!key}
              >
                {busy === "download" ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Download size={16} />
                )}
                {key ? "Setup key already created" : "Download collector setup"}
              </button>
              <p className="footnote">
                The ZIP includes a secret in .env. Save it privately; the server
                stores only its hash. No database or account password is
                included.
              </p>
              {key ? (
                <div className="setup-key">
                  <span>
                    <ShieldCheck size={15} /> Key {key.prefix}… · created{" "}
                    {new Date(key.created_at).toLocaleString()}
                  </span>
                  <p className="footnote">
                    Use the ZIP you downloaded. If it was lost or exposed,
                    revoke this key and download a replacement. Revocation stops
                    existing uploads.
                  </p>
                  <button
                    className="text-button"
                    disabled={!!busy}
                    onClick={() => void revoke()}
                  >
                    <Unplug size={14} />
                    Revoke collector key
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="setup-instructions">
          <span className="eyebrow">
            <Terminal size={14} /> 02 / START AND VERIFY
          </span>
          <h3>Bring a real network online.</h3>
          <p>
            Extract the ZIP, open its sentinel-network folder in a terminal, and
            follow README.md. To start the included lab with Docker:
          </p>
          <pre>chmod 600 .env{"\n"}docker compose up -d --build</pre>
          <p className="footnote">
            If your installation uses the standalone command, use
            docker-compose. The lab requires Linux containers with privileged
            networking; it generates isolated lab traffic and does not capture
            your normal computer traffic. For your own SDN, use the
            existing-controller instructions in the README.
          </p>
          <div className="setup-live-status" aria-live="polite">
            <Radio size={16} />
            <div>
              <strong>
                {connected
                  ? measured
                    ? "Network measurements received"
                    : "Controller online · awaiting flows"
                  : online.length
                    ? "Collector online · controller unreachable"
                    : data.collectors.length
                      ? "Collector offline"
                      : "Awaiting your collector"}
              </strong>
              <small>
                {latest
                  ? `Last collector capture: ${new Date(latest).toLocaleString()}`
                  : "No collector has connected to this workspace."}
              </small>
              <small>
                {measured
                  ? `Last measured flow: ${new Date(data.summary.last_flow!).toLocaleString()}`
                  : "The first poll establishes a baseline. Allow 60–90 seconds for the next counter window."}
              </small>
            </div>
          </div>
          <button
            className="button secondary"
            disabled={!!busy}
            onClick={() =>
              void run("check", async () => {
                setMessage("Connection status refreshed from your workspace.");
              })
            }
          >
            {busy === "check" ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <Radio size={15} />
            )}
            Check connection
          </button>
        </div>
      </div>
      <p className="setup-model-note">
        <ShieldCheck size={16} /> The shared pretrained research model runs on
        your measured flows. Its published evaluation metrics are not the
        accuracy of your network. No enforcement is enabled.
      </p>
    </section>
  );
}
