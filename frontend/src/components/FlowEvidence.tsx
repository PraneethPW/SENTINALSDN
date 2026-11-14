import { ArrowRight } from "lucide-react";
import { protocolName } from "../api";
import type { Flow } from "../api";

export default function FlowEvidence({ flow }: { flow: Flow }) {
  const verdict = flow.prediction === "attack" ? "Flagged" : flow.prediction === "benign" ? "Benign" : "Unclassified";
  const score = flow.attack_probability === null ? "Unavailable" : `${(flow.attack_probability * 100).toFixed(2)}%`;
  return (
    <div className="live-flow-evidence">
      <div className="flow-address"><span>{flow.source_ip}</span><ArrowRight size={15} /><span>{flow.destination_ip}</span></div>
      <p>{flow.collector_id} · Switch {flow.switch_id} · {new Date(flow.observed_at).toLocaleString()}</p>
      <dl>
        <div><dt>Recorded verdict</dt><dd>{verdict}</dd></div>
        <div><dt>Attack score</dt><dd>{score}</dd></div>
        <div><dt>Model version</dt><dd>{flow.model_version ?? "Unavailable"}</dd></div>
        <div><dt>Measurement interval</dt><dd>{Number(flow.interval_seconds).toFixed(2)} s</dd></div>
      </dl>
      <h3>Model inputs</h3>
      <dl>
        <div><dt>Packet rate</dt><dd>{Number(flow.packet_rate).toFixed(2)} pkt/s</dd></div>
        <div><dt>Byte rate</dt><dd>{Number(flow.byte_rate).toFixed(2)} B/s</dd></div>
        <div><dt>Mean packet size</dt><dd>{(flow.bytes / flow.packets).toFixed(2)} B</dd></div>
        <div><dt>Flow duration</dt><dd>{Number(flow.duration_seconds).toFixed(2)} s</dd></div>
        <div><dt>Protocol</dt><dd>{protocolName(flow.protocol)} ({flow.protocol})</dd></div>
      </dl>
    </div>
  );
}
