import { Activity, Radar } from "lucide-react";
import { compact, time } from "../api";
import type { Snapshot } from "../api";

export function TrafficChart({ data }: { data: Snapshot | null }) {
  const series = data?.series ?? [];
  const max = Math.max(1, ...series.map((point) => Number(point.bps)));
  const start = data
    ? new Date(data.timestamp).getTime() - data.window_minutes * 60000
    : 0;
  const end = data ? new Date(data.timestamp).getTime() : 1;
  const points = (field: "bps" | "attack_bps") =>
    series
      .map(
        (point) =>
          `${Math.max(0, Math.min(900, ((new Date(point.time).getTime() - start) / (end - start)) * 900))},${180 - (Number(point[field]) / max) * 150}`,
      )
      .join(" ");
  return (
    <div className="chart-container">
      <div className="chart-axis">
        <span>{compact(max, "bps")}</span>
        <span>{compact(max / 2, "bps")}</span>
        <span>0</span>
      </div>
      <div className="chart-inner">
        <svg
          viewBox="0 0 900 200"
          preserveAspectRatio="none"
          role="img"
          aria-label={
            series.length
              ? "Measured traffic in thirty second buckets"
              : "No measured traffic in the selected window"
          }
        >
          <defs>
            <linearGradient id="traffic-fill" x1="0" y1="0" x2="0" y2="1">
              <stop stopColor="#dfb874" stopOpacity=".23" />
              <stop offset="1" stopColor="#dfb874" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[30, 80, 130, 180].map((y) => (
            <line
              key={y}
              x1="0"
              x2="900"
              y1={y}
              y2={y}
              stroke="#ffffff0a"
              strokeDasharray="4 5"
            />
          ))}
          {series.length > 1 ? (
            <>
              <polygon
                points={`${points("bps")} ${Math.max(0, Math.min(900, ((new Date(series.at(-1)!.time).getTime() - start) / (end - start)) * 900))},180 ${Math.max(0, ((new Date(series[0].time).getTime() - start) / (end - start)) * 900)},180`}
                fill="url(#traffic-fill)"
              />
              <polyline
                points={points("bps")}
                fill="none"
                stroke="#dfb874"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={points("attack_bps")}
                fill="none"
                stroke="#dc796b"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : null}
        </svg>
        {series.length < 2 ? (
          <div className="chart-empty">
            <Activity size={21} strokeWidth={1} />
            <span>
              {series.length === 1
                ? "Collecting the next measurement"
                : "Listening for your first flow"}
            </span>
            <small>Only measured traffic appears here.</small>
          </div>
        ) : null}
        <div className="chart-times">
          <span>{data ? time(new Date(start).toISOString()) : "—"}</span>
          <span>
            {data ? time(new Date((start + end) / 2).toISOString()) : "—"}
          </span>
          <span>{data ? time(data.timestamp) : "Now"}</span>
        </div>
      </div>
    </div>
  );
}

export function Topology({
  data,
  large = false,
}: {
  data: Snapshot | null;
  large?: boolean;
}) {
  const switches = (data?.collectors ?? []).flatMap((c) =>
    c.switches.map((id) => ({
      id: `${c.id}/${id}`,
      label: `SW-${id}`,
      online: c.online && c.controller_status === "connected",
    })),
  );
  return (
    <div className={`topology ${large ? "large" : ""}`}>
      <div className="topology-grid" />
      {switches.length ? (
        <div className="topology-nodes">
          <div className="controller-node">
            <Radar size={28} />
            <span>Controller plane</span>
          </div>
          <div className="switch-row">
            {switches.map((s) => (
              <div className="switch-node" key={s.id}>
                <div className={s.online ? "node-icon online" : "node-icon"}>
                  <Activity size={20} />
                </div>
                <span>{s.label}</span>
                <small>{s.online ? "Observed" : "Last known"}</small>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="topology-empty">
          <div className="radar-rings">
            <Radar size={29} strokeWidth={1} />
          </div>
          <strong>Your network, in focus.</strong>
          <span>Connect a collector to discover switches.</span>
        </div>
      )}
      <span className="topology-caption">
        {switches.length
          ? "Reported switch membership · physical links not inferred"
          : "AWAITING CONTROLLER DISCOVERY"}
      </span>
    </div>
  );
}
