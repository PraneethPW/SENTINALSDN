import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  animate,
} from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Check,
  ChevronDown,
  Cpu,
  Fingerprint,
  Layers3,
  LockKeyhole,
  Network,
  Pause,
  Radio,
  Shield,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { request } from "./api";
import { readSession } from "./session";
const Scene = lazy(() => import("./components/LandingScene"));
type Evidence = {
  model_ready: boolean;
  version: string | null;
  algorithm: string | null;
  features: number | null;
  window_seconds: number | null;
  precision: number | null;
  recall: number | null;
  scope: string;
};
function Count({
  value,
  decimals = 0,
  suffix = "",
  still = false,
}: {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  still?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null),
    inside = useInView(ref, { once: true, amount: 0.6 }),
    systemReduced = useReducedMotion(),
    reduced = still || systemReduced;
  const counter = useMotionValue(0);
  const [text, setText] = useState("—");
  useEffect(
    () => counter.on("change", (x) => setText(x.toFixed(decimals))),
    [counter, decimals],
  );
  useEffect(() => {
    if (value == null) return;
    if (reduced) {
      counter.set(value);
      return;
    }
    if (inside) {
      const controls = animate(counter, value, {
        duration: 1.6,
        ease: [0.2, 0.7, 0.2, 1],
      });
      return () => controls.stop();
    }
  }, [inside, value, reduced, counter]);
  return (
    <span
      ref={ref}
      aria-label={
        value == null ? "Unavailable" : `${value.toFixed(decimals)}${suffix}`
      }
    >
      <span aria-hidden="true">
        {value == null ? "—" : text}
        {value != null ? suffix : ""}
      </span>
    </span>
  );
}
function Tilt({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion(),
    x = useMotionValue(0),
    y = useMotionValue(0),
    rx = useSpring(x, { stiffness: 160, damping: 22 }),
    ry = useSpring(y, { stiffness: 160, damping: 22 });
  return (
    <motion.div
      className={className}
      style={{
        rotateX: reduced ? 0 : rx,
        rotateY: reduced ? 0 : ry,
        transformPerspective: 1000,
      }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType === "touch") return;
        const r = e.currentTarget.getBoundingClientRect();
        x.set((-(e.clientY - r.top - r.height / 2) / r.height) * 7);
        y.set(((e.clientX - r.left - r.width / 2) / r.width) * 7);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}
export function Brand() {
  return (
    <a href="/" className="lp-brand" aria-label="Sentinel home">
      <Shield size={27} strokeWidth={1.3} />
      <span>
        SENTINEL<small>NETWORK INTELLIGENCE</small>
      </span>
    </a>
  );
}
export default function Landing() {
  const systemReduced = useReducedMotion(),
    [paused, setPaused] = useState(false);
  const reduced = !!systemReduced || paused;
  const { scrollYProgress } = useScroll();
  const coreY = useTransform(scrollYProgress, [0, 0.4], [0, 110]);
  const wordX = useTransform(scrollYProgress, [0, 1], [0, -180]);
  const [evidence, setEvidence] = useState<Evidence | null>(null),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    void request<Evidence>("/api/public/overview", null, {
      signal: controller.signal,
    })
      .then(setEvidence)
      .catch((e) => {
        if (e.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);
  const reveal = {
    initial: { opacity: 0, y: reduced ? 0 : 28 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.12 },
    transition: { duration: reduced ? 0 : 0.65 },
  };
  return (
    <div className={`landing ${reduced ? "lp-still" : ""}`}>
      <motion.div
        className="lp-progress"
        style={{ scaleX: reduced ? 0 : scrollYProgress }}
      />
      <a href="#landing-main" className="lp-skip">
        Skip to content
      </a>
      <header className="lp-nav">
        <Brand />
        <nav aria-label="Landing navigation">
          <a href="#capabilities">Capabilities</a>
          <a href="#how-it-works">How it works</a>
          <a href="#evidence">The evidence</a>
        </nav>
        <div className="lp-nav-actions">
          <button
            className="lp-motion"
            onClick={() => setPaused(!paused)}
            aria-label={
              paused ? "Enable landing animations" : "Pause landing animations"
            }
            aria-pressed={paused}
          >
            {reduced ? <Pause size={16} /> : <Activity size={16} />}
          </button>
          <a className="lp-login" href="/auth/sign-in">
            Sign in
          </a>
          <a
            className="lp-button lp-button-small"
            href={readSession() ? "/app" : "/auth/register"}
          >
            {readSession() ? "Open console" : "Get started"}
            <ArrowUpRight size={15} />
          </a>
        </div>
      </header>
      <main id="landing-main">
        <section className="lp-hero">
          <div className="lp-hero-grid" aria-hidden="true" />
          <div className="lp-hero-halo" aria-hidden="true" />
          <div className="lp-hero-copy">
            <motion.p
              className="lp-kicker"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
            >
              <span className="lp-signal-dot" /> SOFTWARE DEFINED. HUMAN
              UNDERSTOOD.
            </motion.p>
            <h1>
              <motion.span
                initial={{ opacity: 0, y: reduced ? 0 : 32 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7 }}
              >
                See beyond
              </motion.span>
              <motion.span
                initial={{ opacity: 0, y: reduced ? 0 : 32 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: reduced ? 0 : 0.12 }}
              >
                the <em>surge.</em>
              </motion.span>
            </h1>
            <motion.p
              className="lp-hero-description"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: reduced ? 0 : 0.3 }}
            >
              Make sense of your network’s every move. Measured SDN telemetry,
              machine learning detection, and a workspace built for a clearer
              response.
            </motion.p>
            <div className="lp-hero-ctas">
              <a href="/auth/register" className="lp-button">
                Create your account
                <ArrowUpRight size={18} />
              </a>
              <a href="#how-it-works" className="lp-text-link">
                Discover the system
                <ArrowDown size={16} />
              </a>
            </div>
            <div className="lp-hero-assurance">
              <span>
                <LockKeyhole size={13} /> Private workspace access
              </span>
              <span>
                <Check size={13} /> Real measured telemetry
              </span>
            </div>
          </div>
          <motion.div className="lp-visual" style={{ y: reduced ? 0 : coreY }}>
            <div className="lp-visual-cross lp-cross-a">+</div>
            <div className="lp-visual-cross lp-cross-b">+</div>
            <div className="lp-orbit-outline" />
            <Suspense
              fallback={
                <div className="lp-css-core">
                  <i />
                  <i />
                  <i />
                </div>
              }
            >
              <Scene reduced={reduced} progress={scrollYProgress} />
            </Suspense>
            <div className="lp-visual-label">
              <span className="lp-signal-dot" /> SIGNAL CORE / 001
              <small>Conceptual geometry · scroll to explore</small>
            </div>
            <motion.div
              className="lp-floating-label lp-floating-a"
              animate={reduced ? {} : { y: [0, -12, 0] }}
              transition={{ duration: 6, repeat: Infinity }}
            >
              <Radio size={15} />
              <span>
                COLLECT<small>From switch to signal</small>
              </span>
            </motion.div>
            <motion.div
              className="lp-floating-label lp-floating-b"
              animate={reduced ? {} : { y: [0, 10, 0] }}
              transition={{ duration: 7, repeat: Infinity }}
            >
              <Cpu size={15} />
              <span>
                INTERPRET<small>Five measured features</small>
              </span>
            </motion.div>
          </motion.div>
          <div className="lp-hero-bottom">
            <span>OPENFLOW 1.3</span>
            <i />
            <span>NEON POSTGRESQL</span>
            <i />
            <span>EXTRA TREES ML</span>
            <a href="#capabilities">
              SCROLL TO OBSERVE
              <ArrowDown size={13} />
            </a>
          </div>
        </section>
        <section className="lp-intro lp-wrap" id="capabilities">
          <motion.div {...reveal} className="lp-section-heading">
            <p className="lp-kicker">01 / THE BIGGER PICTURE</p>
            <h2>
              Less noise.
              <br />
              <span>More understanding.</span>
            </h2>
            <p>
              A defense console that connects the raw behavior of a software
              defined network to the people responsible for it.
            </p>
          </motion.div>
          <div className="lp-bento">
            <Tilt className="lp-feature lp-feature-wide">
              <div className="lp-feature-top">
                <span className="lp-module">01 / OBSERVABILITY</span>
                <Activity size={20} />
              </div>
              <h3>
                Find the pulse.
                <br />
                Follow the evidence.
              </h3>
              <p>
                Measured counters become live flow windows, searchable history,
                and discovered network topology. Reconnect without losing
                persisted evidence.
              </p>
              <div className="lp-pipeline" aria-label="Telemetry architecture">
                <span>
                  <Network />
                  OPENFLOW
                </span>
                <i />
                <span>
                  <Radio />
                  COLLECTOR
                </span>
                <i />
                <span>
                  <Cpu />
                  ML ENGINE
                </span>
              </div>
              <small className="lp-diagram-note">
                System architecture · illustrated flow
              </small>
            </Tilt>
            <Tilt className="lp-feature lp-access-card">
              <div className="lp-feature-top">
                <span className="lp-module">02 / ACCESS</span>
                <LockKeyhole size={20} />
              </div>
              <div className="lp-fingerprint">
                <Fingerprint strokeWidth={0.7} />
                <span />
              </div>
              <h3>
                Your network.
                <br />
                Your circle.
              </h3>
              <p>
                A private workspace at registration, your own collector, and clear viewer,
                operator, and administrator roles.
              </p>
            </Tilt>
            <Tilt className="lp-feature lp-investigate-card">
              <div className="lp-feature-top">
                <span className="lp-module">03 / INVESTIGATION</span>
                <Layers3 size={20} />
              </div>
              <h3>
                A response
                <br />
                with context.
              </h3>
              <p>
                Assign an investigator. Preserve notes. Review the model
                evidence. Optional AI helps summarize, while operators stay in
                control.
              </p>
              <div className="lp-state-chain">
                <span>DETECT</span>
                <ArrowRight size={14} />
                <span>REVIEW</span>
                <ArrowRight size={14} />
                <span>RESPOND</span>
              </div>
            </Tilt>
          </div>
        </section>
        <section className="lp-process lp-wrap" id="how-it-works">
          <div className="lp-process-title">
            <p className="lp-kicker">02 / FROM SIGNAL TO CLARITY</p>
            <h2>
              Every layer.
              <br />
              <em>Connected.</em>
            </h2>
            <p>
              Actual measurements in.
              <br />
              Actionable evidence out.
            </p>
            <a className="lp-text-link" href="/auth/register">
              Find your perspective
              <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="lp-process-steps">
            {[
              {
                n: "01",
                title: "Observe what is there.",
                body: "A collector beside your controller reads OpenFlow counters and discovered links. Real network activity becomes durable flow windows.",
                icon: Radio,
              },
              {
                n: "02",
                title: "Give behavior meaning.",
                body: "A versioned Extra Trees model evaluates five measured features. Model flags retain their evidence, timestamps, and model version.",
                icon: Cpu,
              },
              {
                n: "03",
                title: "Respond with intention.",
                body: "Investigators review, assign, acknowledge, and resolve. Mitigation is a separate, scoped operator action that requires network validation.",
                icon: ShieldCheck,
              },
            ].map(({ n, title, body, icon: Icon }) => (
              <motion.article className="lp-step" key={n} {...reveal}>
                <span className="lp-step-num">{n}</span>
                <div>
                  <Icon size={23} strokeWidth={1.2} />
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </motion.article>
            ))}
          </div>
        </section>
        <section className="lp-evidence" id="evidence">
          <div className="lp-wrap">
            <motion.div {...reveal} className="lp-evidence-heading">
              <div>
                <p className="lp-kicker">03 / NUMBERS WITH A SOURCE</p>
                <h2>
                  Measured.
                  <br />
                  <em>Never imagined.</em>
                </h2>
              </div>
              <p>
                These are facts from the installed model artifact. Public
                laboratory evaluation, with its limits visible. Operational
                traffic stays inside your private workspace.
              </p>
            </motion.div>
            <div className="lp-number-grid">
              {[
                {
                  label: "Measurement window",
                  value: evidence?.window_seconds,
                  suffix: "s",
                  note: "Model-compatible sampling",
                },
                {
                  label: "Measured flow features",
                  value: evidence?.features,
                  suffix: "",
                  note: "Behavior, not endpoint identity",
                },
                {
                  label: "Attack precision",
                  value:
                    evidence?.precision == null
                      ? null
                      : evidence.precision * 100,
                  suffix: "%",
                  decimals: 1,
                  note: "Public lab group-test partition",
                },
                {
                  label: "Attack recall",
                  value:
                    evidence?.recall == null ? null : evidence.recall * 100,
                  suffix: "%",
                  decimals: 1,
                  note: "Public lab group-test partition",
                },
              ].map((metric, i) => (
                <motion.div {...reveal} key={metric.label}>
                  <Tilt className="lp-number-card">
                    <span className="lp-metric-index">/ 0{i + 1}</span>
                    <strong>
                      <Count
                        still={reduced}
                        value={metric.value}
                        suffix={metric.suffix}
                        decimals={metric.decimals}
                      />
                    </strong>
                    <h3>{metric.label}</h3>
                    <p>{metric.note}</p>
                  </Tilt>
                </motion.div>
              ))}
            </div>
            {failed ? (
              <p className="lp-evidence-error" role="status">
                Model facts are temporarily unavailable.{" "}
                <button onClick={() => setAttempt((x) => x + 1)}>
                  Try again
                </button>
              </p>
            ) : null}
            <p className="lp-evidence-note">
              {evidence?.version ? (
                <>
                  <span className="lp-signal-dot" />
                  {evidence.algorithm} · {evidence.version} ·{" "}
                </>
              ) : null}
              Independent network validation is required before enforcement.
              Model scores are estimates, not certainty.{" "}
              <a
                href="https://github.com/PraneethPW/SENTINALSDN/blob/main/README.md"
                target="_blank"
                rel="noreferrer"
              >
                Read the model notes
                <ArrowUpRight size={12} />
              </a>
            </p>
          </div>
        </section>
        <section className="lp-faq lp-wrap">
          <div>
            <p className="lp-kicker">A LITTLE MORE CLARITY</p>
            <h2>
              Before you
              <br />
              <span>step inside.</span>
            </h2>
          </div>
          <div>
            {[
              {
                q: "What happens after I register?",
                a: "You immediately own a private, empty workspace. Download its collector setup to connect your SDN controller or start an isolated real Mininet lab. Other users’ traffic and incidents never appear in your workspace.",
              },
              {
                q: "Can I run everything locally?",
                a: "Yes. The local stack runs its own PostgreSQL, API, model inference, frontend, and isolated Mininet network. Core monitoring does not require the deployed services.",
              },
              {
                q: "Does detection automatically block traffic?",
                a: "No. Model detections are advisory. Blocking remains disabled pending independent validation and requires explicit operator review when enabled.",
              },
              {
                q: "What does Google sign-in access?",
                a: "The integration requests only basic identity: your Google account identifier, verified email, and profile name. Your private workspace is created immediately; existing accounts keep their workspace permissions.",
              },
            ].map((item) => (
              <details key={item.q}>
                <summary>
                  {item.q}
                  <ChevronDown size={17} />
                </summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="lp-final lp-wrap">
          <motion.div {...reveal}>
            <p className="lp-kicker">
              <Sparkles size={14} /> A CLEARER VIEW STARTS HERE
            </p>
            <h2>
              Know your network.
              <br />
              <em>Own your response.</em>
            </h2>
            <a className="lp-button" href="/auth/register">
              Create your account
              <ArrowUpRight size={18} />
            </a>
            <span className="lp-final-note">
              Already part of the workspace?{" "}
              <a href="/auth/sign-in">
                Sign in
                <ArrowRight size={13} />
              </a>
            </span>
          </motion.div>
          <div className="lp-final-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <Shield strokeWidth={0.5} />
          </div>
        </section>
      </main>
      <footer className="lp-footer lp-wrap">
        <div>
          <Brand />
          <p>
            Machine learning-based DDoS detection
            <br />
            in software defined networks.
          </p>
        </div>
        <div className="lp-footer-links">
          <a href="/privacy">Privacy</a>
          <a
            href="https://github.com/PraneethPW/SENTINALSDN"
            target="_blank"
            rel="noreferrer"
          >
            Source
            <ArrowUpRight size={13} />
          </a>
          <a href="/auth/sign-in">
            Workspace
            <ArrowUpRight size={13} />
          </a>
        </div>
        <motion.div
          className="lp-wordmark"
          style={{ x: reduced ? 0 : wordX }}
          aria-hidden="true"
        >
          SENTINEL
        </motion.div>
        <div className="lp-footer-bottom">
          <span>DESIGNED FOR VISIBILITY.</span>
          <span>OBSERVE. UNDERSTAND. DEFEND.</span>
        </div>
      </footer>
    </div>
  );
}
