import { ArrowDown, ArrowRight, ArrowUpRight, Binary, Network, ScanLine } from "lucide-react";
import PublicHeader, { Brand } from "./components/PublicHeader";
import { readSession } from "./session";
import BenchmarkReference from "./components/BenchmarkReference";

export default function Landing() {
  return (
    <div className="research">
      <PublicHeader />
      <main className="research-width research-main">
        <section className="research-hero">
          <div className="research-hero-image" />
          <div className="research-hero-copy">
            <p className="research-eyebrow"><span /> NETWORK SECURITY RESEARCH</p>
            <h1>DDoS detection.<br /><em>Test every verdict.</em></h1>
            <p className="research-hero-description">
              Machine Learning-Based DDoS Attack Detection in Software Defined Networks
            </p>
            <div className="research-actions">
              <a className="research-button primary" href="/auth/sign-in#benchmark">
                Open Detection Lab <ArrowRight size={19} />
              </a>
              <a className="research-button ghost" href="#benchmark-evidence">
                View results <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <div className="research-hero-caption">OPENFLOW 1.3 <span /> EXTRA TREES CLASSIFIER</div>
        </section>
        <div id="benchmark-evidence" className="landing-reference">
          <BenchmarkReference action={
            <a className="research-button ghost" href="/auth/sign-in#upload-dataset">Try your dataset <ArrowUpRight size={16} /></a>
          } />
        </div>
        <section className="research-method" id="methodology" aria-labelledby="method-title">
          <div className="research-section-title">
            <div>
              <p className="research-eyebrow">METHODOLOGY</p>
              <h2 id="method-title">From switch to verdict.</h2>
            </div>
            <a href="https://github.com/PraneethPW/SENTINALSDN" className="research-text-link">
              View repository <ArrowUpRight size={16} />
            </a>
          </div>
          <div className="research-pipeline">
            <article>
              <Network size={22} /><h3>Measure</h3>
              <p>The collector polls OpenFlow switches and converts counter deltas into measured flow windows.</p>
            </article>
            <article>
              <Binary size={22} /><h3>Classify</h3>
              <p>A verified Extra Trees model scores each window using packet rate, byte rate, packet size, duration and protocol.</p>
            </article>
            <article>
              <ScanLine size={22} /><h3>Verify</h3>
              <p>Rerun the detector on published SDN test data. Compare its decisions to the labels and inspect individual errors.</p>
            </article>
          </div>
        </section>
        <section className="research-live">
          <div>
            <p className="research-eyebrow">LIVE TELEMETRY</p>
            <h2>Connect your network.</h2>
            <p>Track measured flows, topology and incidents in your private workspace. Use an OpenFlow collector or start an isolated Mininet lab when a host is available.</p>
          </div>
          <a href={readSession() ? "/app" : "/auth/sign-in"} className="research-button ghost">
            Open live workspace <ArrowUpRight size={16} />
          </a>
        </section>
      </main>
      <footer className="research-width research-footer">
        <Brand /><a href="/privacy">Privacy</a>
      </footer>
    </div>
  );
}
