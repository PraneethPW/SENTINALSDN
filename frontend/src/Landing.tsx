import { ArrowRight, ArrowUpRight } from "lucide-react";
import PublicHeader, { Brand } from "./components/PublicHeader";
import { readSession } from "./session";
import BenchmarkReference from "./components/BenchmarkReference";

const method = [
  ["Capture", "OpenFlow switch counters", "The collector calculates packet and byte deltas from 30-second measurements."],
  ["Score", "Extra Trees classifier", "Five inputs: packet rate, byte rate, mean packet size, flow duration, and protocol."],
  ["Evaluate", "Group-held-out Mininet windows", "Training, threshold selection, and testing use separate endpoint/protocol groups."],
];

export default function Landing() {
  return (
    <div className="research">
      <PublicHeader />
      <main className="research-width research-main">
        <div className="project-overview">
          <section className="project-intro" aria-labelledby="project-title">
            <p className="project-label">Final-year computer science project</p>
            <h1 id="project-title">Machine Learning-Based DDoS Attack Detection in Software Defined Networks</h1>
            <p className="project-description">
              Sentinel reads OpenFlow counters and scores each 30-second flow window for DDoS activity. Run the classifier against published test data or upload a capture from your own network.
            </p>
            <div className="research-actions">
              <a className="research-button primary" href="/auth/sign-in#benchmark">Open Detection Lab <ArrowRight size={17} /></a>
              <a className="research-button ghost" href="/auth/sign-in#upload-dataset">Test a CSV</a>
            </div>
            <dl className="project-spec">
              <div><dt>Telemetry</dt><dd>OpenFlow 1.3</dd></div>
              <div><dt>Classifier</dt><dd>Extra Trees</dd></div>
              <div><dt>Window</dt><dd>30 seconds</dd></div>
            </dl>
          </section>
          <div id="benchmark-evidence" className="landing-reference benchmark-embed">
            <BenchmarkReference />
          </div>
        </div>
        <section className="research-method" id="methodology" aria-labelledby="method-title">
          <div className="research-section-title">
            <h2 id="method-title">How the detector works</h2>
            <a href="https://github.com/PraneethPW/SENTINALSDN" className="research-text-link">Source code <ArrowUpRight size={15} /></a>
          </div>
          <ol className="method-steps">
            {method.map(([step, name, detail]) => (
              <li key={step}><span>{step}</span><h3>{name}</h3><p>{detail}</p></li>
            ))}
          </ol>
        </section>
        <section className="research-live">
          <div><h2>Live OpenFlow workspace</h2><p>Start a private Mininet lab or connect a collector to inspect real switch counters and recorded verdicts.</p></div>
          <a href={readSession() ? "/app" : "/auth/sign-in"} className="research-button ghost">Open workspace <ArrowUpRight size={15} /></a>
        </section>
      </main>
      <footer className="research-width research-footer"><Brand /><a href="/privacy">Privacy</a></footer>
    </div>
  );
}
