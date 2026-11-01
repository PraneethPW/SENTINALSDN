import { useEffect, useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Check,
  FlaskConical,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Square,
  Timer,
  ShieldCheck,
} from "lucide-react";
import { request, time } from "../api";
import type { Snapshot, User } from "../api";
const labels = {
  queued: "Queued for startup",
  starting: "Creating your network",
  awaiting_controller: "Connecting the controller",
  awaiting_flows: "Measuring the first traffic window",
  running: "Your live lab is running",
  stopping: "Stopping your lab",
  stopped: "Your lab is stopped",
  failed: "Your lab needs a restart",
  expired: "Your lab session ended",
};
export default function ManagedLabPanel({
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
  const lab = data.workspace?.lab,
    run = lab?.run,
    title = useId(),
    reduced = useReducedMotion();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const active = run?.desired_state === "running" && run.state !== "expired",
    stopping = !!run && !run.stopped_at && !active;
  const collector = data.collectors.find((c) => c.id === run?.collector_id);
  const live =
    active &&
    run?.state === "running" &&
    !!collector?.online &&
    collector.controller_status === "connected";
  const remaining = run
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(run.expires_at) - Math.max(now, Date.now())) / 60000,
          ),
        )
      : 0,
    host = lab?.host;
  const hostMessage = !host?.enabled
    ? "The managed lab host has not been configured."
    : !host.online
      ? "The research host is offline. Start will become available when it reconnects."
      : !host.ready
        ? host.reason === "preparing"
          ? "The host is preparing its network image. This can take a few minutes on first startup."
          : "The host is reconnecting to its network engine."
        : !host.can_start
          ? "All lab slots are in use. This status updates automatically."
          : "The research host is ready for your private network.";
  async function action(kind: "start" | "stop" | "restart") {
    if (busy) return;
    setBusy(kind);
    setError("");
    try {
      await request(`/api/workspace/lab/${kind}`, token, {
        method: "POST",
        body: JSON.stringify({ request_id: crypto.randomUUID() }),
      });
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The lab request failed. Try again.",
      );
    } finally {
      setBusy("");
    }
  }
  const steps = [
    {
      title: "Private network",
      detail: "Isolated Mininet switches and hosts",
      done: !!run?.started_at,
    },
    {
      title: "SDN controller",
      detail: "OpenFlow discovery and counters",
      done: !!run?.controller_seen_at,
    },
    {
      title: "Real measurements",
      detail: "First measured traffic window",
      done: !!run?.first_flow_at,
    },
  ];
  return (
    <motion.section
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`managed-lab panel ${live ? "lab-is-live" : ""}`}
      aria-labelledby={title}
    >
      <div className="lab-heading">
        <span className="setup-emblem">
          <FlaskConical size={27} strokeWidth={1.3} />
        </span>
        <div>
          <span className="eyebrow">PRIVATE RESEARCH NETWORK / MININET</span>
          <h2 id={title}>
            {active && run?.state === "running" && !live
              ? "Waiting for current telemetry"
              : run
                ? labels[run.state]
                : "A real network. One click away."}
          </h2>
          <p>
            {active
              ? "Your own switches, controller, and collector. Follow startup below; measured traffic streams directly into this workspace."
              : "Start an isolated research network with real packets. We handle the controller and collector automatically."}
          </p>
        </div>
        <span className={`lab-status ${live ? "live" : ""}`}>
          <Radio size={13} />
          {live
            ? "MEASURING"
            : active
              ? "STARTING"
              : stopping
                ? "CLEANUP"
                : "ON DEMAND"}
        </span>
      </div>
      {error ? (
        <p className="form-error operation-message" role="alert">
          {error}
        </p>
      ) : null}
      {run?.message ? (
        <p className="operation-message" role="status">
          {run.message}
        </p>
      ) : null}
      <ol className="lab-steps">
        {steps.map((step, i) => (
          <li key={step.title} className={step.done ? "complete" : ""}>
            <span>
              {step.done ? (
                <Check size={16} />
              ) : active && steps.slice(0, i).every((s) => s.done) ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                String(i + 1).padStart(2, "0")
              )}
            </span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="lab-footer">
        <div className="lab-actions">
          {user.role === "admin" ? (
            <>
              {!active ? (
                <button
                  className="button primary"
                  disabled={!!busy || !host?.can_start || stopping}
                  onClick={() => void action("start")}
                >
                  {busy === "start" ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <Play size={16} />
                  )}
                  Start my live lab
                </button>
              ) : (
                <>
                  <button
                    className="button secondary"
                    disabled={!!busy}
                    onClick={() => void action("stop")}
                  >
                    {busy === "stop" ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Square size={14} />
                    )}
                    Stop lab
                  </button>
                  <button
                    className="text-button"
                    disabled={!!busy || !host?.can_start}
                    onClick={() => void action("restart")}
                  >
                    {busy === "restart" ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <RotateCcw size={15} />
                    )}
                    Restart with a fresh network
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="footnote">
              Your workspace administrator can start or stop the lab.
            </p>
          )}
        </div>
        <div className="lab-timing">
          <Timer size={15} />
          <span>
            {active
              ? `${remaining} min left in this session`
              : `Up to ${lab?.limits.session_minutes ?? 60} minutes per session`}
            <small>
              {active && run?.first_flow_at
                ? `First measurement ${time(run.first_flow_at)}`
                : "Allow 60–90 seconds for the first measurement."}
            </small>
          </span>
        </div>
      </div>
      <p className="lab-host-state">
        <i className={host?.ready ? "ready" : ""} />
        {hostMessage}
        {host?.ready
          ? ` ${host.available_slots} of ${host.capacity} slots available.`
          : ""}
      </p>
      <p className="setup-model-note">
        <ShieldCheck size={16} />
        <span>
          This lab measures its own bounded traffic. It does not monitor your
          personal devices. Sessions stop after {lab?.limits.idle_minutes ?? 15}{" "}
          minutes with the console closed or hidden. Measurement history stays
          in your workspace; ML results require investigation and blocking
          remains disabled.
        </span>
      </p>
    </motion.section>
  );
}
