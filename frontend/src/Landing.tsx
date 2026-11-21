import { ArrowDown, ArrowUpRight } from "lucide-react";
import PublicHeader, { Brand } from "./components/PublicHeader";
import { readSession } from "./session";
import BenchmarkReference from "./components/BenchmarkReference";
import { CinematicBackdrop, CinematicChapter } from "./components/CinematicScene";
import { useMotionPreference } from "./motionPreference";
import NetworkHologram from "./components/NetworkHologram";

const method = [
  ["Capture", "OpenFlow switch counters", "The collector calculates packet and byte deltas from 30-second measurements."],
  ["Score", "Extra Trees classifier", "Five inputs: packet rate, byte rate, mean packet size, flow duration, and protocol."],
  ["Evaluate", "Group-held-out Mininet windows", "Training, threshold selection, and testing use separate endpoint/protocol groups."],
];

export default function Landing() {
  const { reduced } = useMotionPreference();
  return (
    <div className={`research cinematic-page${reduced ? " motion-off" : ""}`}>
      <CinematicBackdrop scene="fiber" />
      <PublicHeader />
      <main className="research-width research-main">
        <div className="project-overview">
          <section className="project-intro" aria-labelledby="project-title">
            <p className="project-label"><span className="cockpit-tag">SENTINEL / DEFENSE CONSOLE</span> SDN + MACHINE LEARNING</p>
            <h1 id="project-title">See the signal.<br /><em>Command the network.</em></h1>
            <p className="project-description">
              A new perspective on network defense. Inspect real OpenFlow telemetry, investigate DDoS detections, and put the model to the test in one immersive workspace.
            </p>
            <div className="research-actions">
              <a className="research-button primary" href="/lab#benchmark">Open Detection Lab</a>
              <a className="research-button ghost" href="/auth/register">Create workspace</a>
            </div>
            <dl className="project-spec">
              <div><dt>Telemetry</dt><dd>OpenFlow 1.3</dd></div>
              <div><dt>Classifier</dt><dd>Extra Trees</dd></div>
              <div><dt>Window</dt><dd>30 seconds</dd></div>
            </dl>
          </section>
          <div className="hero-visual">
            <NetworkHologram />
            <div className="hero-visual-caption"><span>OBSERVE · CLASSIFY · INVESTIGATE</span><span>30 SEC / WINDOW</span></div>
          </div>
        </div>
        <div className="mission-strip" aria-label="Project capabilities">
          <span>Machine learning–based DDoS detection in software defined networks</span>
          <span>Real telemetry</span><span>Private workspaces</span><span>Inspectable evidence</span>
        </div>
        <div id="benchmark-evidence" className="landing-reference benchmark-embed">
          <BenchmarkReference action={<a href="/lab#benchmark" className="research-button ghost">Explore the benchmark</a>} />
        </div>
        <div className="project-scroll-link">
          <a className="research-text-link" href="#methodology"><ArrowDown size={15} /> How the detector works</a>
        </div>
        <CinematicChapter scene="silicon" className="method-chapter" id="methodology" labelledBy="method-title">
          <div className="research-section-title">
            <h2 id="method-title">From switch counters to a model verdict</h2>
            <a href="https://github.com/PraneethPW/SENTINALSDN" className="research-text-link">Source code <ArrowUpRight size={15} /></a>
          </div>
          <ol className="method-steps">
            {method.map(([step, name, detail]) => (
              <li key={step}><span>{step}</span><h3>{name}</h3><p>{detail}</p></li>
            ))}
          </ol>
        </CinematicChapter>
        <CinematicChapter scene="rack" className="workspace-chapter" labelledBy="live-workspace-title">
          <div className="live-chapter-copy">
            <h2 id="live-workspace-title">Live OpenFlow workspace</h2>
            <p>Start a private Mininet lab or connect a collector to inspect real switch counters and recorded verdicts.</p>
            <a href={readSession() ? "/app" : "/auth/sign-in"} className="research-button ghost">Open workspace <ArrowUpRight size={15} /></a>
          </div>
        </CinematicChapter>
      </main>
      <footer className="research-width research-footer"><Brand /><a href="/privacy">Privacy</a></footer>
    </div>
  );
}
