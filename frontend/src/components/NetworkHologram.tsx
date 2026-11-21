import { Cpu, Network, ShieldCheck } from "lucide-react";

const nodes = Array.from({ length: 18 }, (_, i) => {
    const angle = i * 2.39996;
    const radius = 55 + (i % 5) * 24;
    return { x: +(260 + Math.cos(angle) * radius).toFixed(2), y: +(240 + Math.sin(angle) * radius * .78).toFixed(2) };
  });
/** Decorative diagram: never substitutes for controller-discovered topology. */
export default function NetworkHologram() {
  return (
    <div className="network-hologram" aria-hidden="true">
      <div className="hologram-orbit orbit-one" />
      <div className="hologram-orbit orbit-two" />
      <svg className="hologram-globe" viewBox="0 0 520 480" fill="none">
        <circle className="holo-halo" cx="260" cy="240" r="177" />
        <circle cx="260" cy="240" r="159" />
        {[-65, -32, 0, 32, 65].map((angle) => (
          <ellipse key={angle} cx="260" cy="240" rx="159" ry="59" transform={`rotate(${angle} 260 240)`} />
        ))}
        <ellipse cx="260" cy="240" rx="64" ry="159" />
        <ellipse cx="260" cy="240" rx="122" ry="159" />
        <g className="holo-links">
          {nodes.map((node, i) => <path key={i} d={`M${node.x},${node.y} L${nodes[(i + 5) % nodes.length].x},${nodes[(i + 5) % nodes.length].y}`} />)}
        </g>
        {nodes.map((node, i) => (
          <g key={i} className="holo-node" style={{ animationDelay: `${i * .2}s` }}>
            <circle cx={node.x} cy={node.y} r="7" />
            <circle cx={node.x} cy={node.y} r="2.5" />
          </g>
        ))}
        <circle className="holo-track" cx="260" cy="240" r="191" strokeDasharray="2 12" />
        <path className="holo-crosshair" d="M260 32v25M260 423v25M52 240h25M443 240h25" />
      </svg>
      <div className="holo-core"><ShieldCheck size={44} strokeWidth={1.2} /></div>
      <span className="holo-label label-top"><Network size={15} /> OPENFLOW 1.3</span>
      <span className="holo-label label-bottom"><Cpu size={15} /> EXTRA TREES ENGINE</span>
      <span className="holo-caption">NETWORK DEFENSE / CONCEPT VIEW</span>
    </div>
  );
}
