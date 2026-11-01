import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  Database,
  Eye,
  Fingerprint,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Network,
  Pause,
  Radio,
  Search,
  Server,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { API, compact, protocolName, request, time } from "./api";
import type { Incident, User } from "./api";
import { useNetwork } from "./useNetwork";
import { WorkspaceControls, FlowHistory } from "./components/WorkspaceControls";
import { Topology, TrafficChart } from "./components/Charts";
import NetworkSetup from "./components/NetworkSetup";

const NetworkScene = lazy(() => import("./components/NetworkScene"));
const sections = [
  { id: "overview", label: "Overview", icon: Layers3 },
  { id: "traffic", label: "Live traffic", icon: Waves },
  { id: "topology", label: "Network topology", icon: Network },
  { id: "incidents", label: "Incidents", icon: Shield },
  { id: "intelligence", label: "Intelligence", icon: Sparkles },
  { id: "system", label: "System settings", icon: Settings2 },
  { id: "setup", label: "Network setup", icon: Radio },
] as const;
type Section = (typeof sections)[number]["id"];
const titles: Record<Section, [string, string]> = {
  overview: ["Network overview", "A clearer view. A stronger perimeter."],
  traffic: ["Live traffic", "Measured flow windows from your workspace."],
  topology: [
    "Network topology",
    "Discover the infrastructure behind the signal.",
  ],
  incidents: [
    "Incident center",
    "Investigate the evidence. Control the response.",
  ],
  intelligence: [
    "Intelligence",
    "Measured by machine learning. Interpreted with context.",
  ],
  system: ["System settings", "Every connection, accounted for."],
  setup: ["Network setup", "Connect your network. Follow every measurement."],
};

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ) ?? []),
      ].filter((el) => !el.hasAttribute("disabled"));
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const els = focusable(),
          first = els[0],
          last = els.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = oldOverflow;
      prior?.focus();
    };
  }, []);
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal ${wide ? "wide" : ""}`}
        initial={{ y: 20, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}

function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
function Empty({
  icon = <Radio size={25} strokeWidth={1.3} />,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}
function PanelHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState<Section>(
    () => sections.find((s) => `#${s.id}` === location.hash)?.id ?? "overview",
  );
  const [minutes, setMinutes] = useState(15);
  const network = useNetwork(minutes);
  const { data, user, token, connection, error } = network;
  const systemReduced = useReducedMotion();
  const [motionOff, setMotionOff] = useState(() => {
    try {
      return localStorage.getItem("sentinel.motion-off") === "true";
    } catch {
      return false;
    }
  });
  const reduced = !!systemReduced || motionOff;
  const [loginOpen, setLoginOpen] = useState(false),
    [guideOpen, setGuideOpen] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(""),
    [toast, setToast] = useState(""),
    [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState<Incident | null>(null);
  const [assignee, setAssignee] = useState("");
  const [assignable, setAssignable] = useState<(User & { active: boolean })[]>(
    [],
  );
  const seenIncidents = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) {
      seenIncidents.current = null;
      return;
    }
    const ids = new Set(data.incidents.map((i) => i.id));
    if (seenIncidents.current) {
      const count = data.incidents.filter(
        (i) => !seenIncidents.current!.has(i.id) && i.status === "open",
      ).length;
      if (count)
        setToast(
          `${count} new model detection${count > 1 ? "s" : ""} need review.`,
        );
    }
    seenIncidents.current = ids;
  }, [data]);
  const [notes, setNotes] = useState(""),
    [report, setReport] = useState(""),
    [analysisId, setAnalysisId] = useState("");
  const [reports, setReports] = useState<
    {
      id: string;
      content: string;
      created_at: string;
      status: string;
      incident_id: string;
    }[]
  >([]);
  const { scrollYProgress: pageProgress } = useScroll();
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const sceneY = useTransform(scrollYProgress, [0, 1], [0, reduced ? 0 : 60]);
  const openIncidents =
    data?.summary.open_incidents ??
    data?.incidents.filter((i) => i.status !== "resolved").length ??
    0;
  const onlineCollectors =
    data?.collectors.filter(
      (c) => c.online && c.controller_status === "connected",
    ) ?? [];
  const switchCount = onlineCollectors.reduce(
    (sum, c) => sum + c.switches.length,
    0,
  );
  const canOperate = !!user && user.role !== "viewer";
  const liveTelemetry = onlineCollectors.length > 0;
  const selectedLatest =
    data?.incidents.find((i) => i.id === selected?.id) ?? selected;

  function navigate(next: Section) {
    setSection(next);
    location.hash = next;
    setMobileNav(false);
    setSearch("");
    setFilter("all");
    window.scrollTo({ top: 0, behavior: reduced ? "instant" : "smooth" });
  }
  useEffect(() => {
    const fn = () =>
      setSection(
        sections.find((s) => `#${s.id}` === location.hash)?.id ?? "overview",
      );
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  useEffect(() => {
    if (!token) {
      setSelected(null);
      setReport("");
      setReports([]);
    }
  }, [token]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (data?.reports) {
      setReports(data.reports);
      return;
    }
    if (section === "intelligence" && token)
      void request<typeof reports>("/api/intelligence/reports", token)
        .then(setReports)
        .catch((e) => setToast(e.message));
  }, [section, token, report, data?.reports]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy("login");
    setLoginError("");
    try {
      await network.login(email, password);
      setLoginOpen(false);
      setPassword("");
    } catch (e) {
      setLoginError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy("");
    }
  }
  async function action(
    key: string,
    work: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    try {
      const changed = await work();
      if (
        changed &&
        typeof changed === "object" &&
        "notes" in changed &&
        "revision" in changed
      )
        setSelected(changed as Incident);
      await network.refresh();
      setToast(success);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy("");
    }
  }
  async function download() {
    if (!token) {
      setLoginOpen(true);
      return;
    }
    await action(
      "export",
      async () => {
        const response = await fetch(
          `${API}/api/flows/export?minutes=${minutes}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok)
          throw new Error("Export failed. Check your connection.");
        const url = URL.createObjectURL(await response.blob()),
          a = document.createElement("a");
        a.href = url;
        a.download = "sentinel-flows.csv";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      "Measured flow windows exported (up to 10,000 rows).",
    );
  }
  async function explain(incident: Incident) {
    setAnalysisId(incident.id);
    await action(
      "explain",
      async () => {
        const result = await request<{ content: string }>(
          "/api/intelligence/explain",
          token,
          {
            method: "POST",
            body: JSON.stringify({ incident_id: incident.id }),
          },
        );
        setReport(result.content);
      },
      "Analysis saved to intelligence history.",
    );
  }
  function openIncident(incident: Incident) {
    setSelected(incident);
    setNotes(incident.notes);
    setAssignee(incident.assignee_id ?? "");
    if (token)
      void request<(User & { active: boolean })[]>("/api/users", token)
        .then(setAssignable)
        .catch(() => setAssignable([]));
    setReport("");
    setAnalysisId("");
  }
  const filteredFlows = (data?.flows ?? []).filter(
    (f) =>
      (filter === "all" || f.prediction === filter) &&
      `${f.source_ip} ${f.destination_ip} ${f.switch_id} ${protocolName(f.protocol)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filteredIncidents = (data?.incidents ?? []).filter(
    (i) =>
      (filter === "all" || i.status === filter) &&
      `${i.source_ip} ${i.destination_ip} ${i.id}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  const flowTable = (limit?: number) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Source / destination</th>
            <th>Protocol</th>
            <th>Packet rate</th>
            <th>ML verdict</th>
            <th>Observed</th>
          </tr>
        </thead>
        <tbody>
          {filteredFlows.slice(0, limit).map((flow) => (
            <tr key={flow.id}>
              <td>
                <span className="flow-address">
                  {flow.source_ip}
                  <ArrowRight size={12} />
                  {flow.destination_ip}
                </span>
                <small>
                  {flow.collector_id ? `${flow.collector_id} · ` : ""}
                  SW-{flow.switch_id}
                  {flow.destination_port !== null
                    ? ` · port ${flow.destination_port}`
                    : ""}
                </small>
              </td>
              <td>
                <span className="protocol-tag">
                  {protocolName(flow.protocol)}
                </span>
              </td>
              <td className="mono">
                {compact(Number(flow.packet_rate), "pps")}
              </td>
              <td>
                <Badge
                  tone={
                    flow.prediction === "attack"
                      ? "danger"
                      : flow.prediction === "benign"
                        ? "success"
                        : "neutral"
                  }
                >
                  {flow.prediction === "attack"
                    ? "Model flagged"
                    : flow.prediction}
                </Badge>
              </td>
              <td className="mono muted">{time(flow.observed_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!filteredFlows.length ? (
        <Empty
          title={
            search || filter !== "all"
              ? "No matching flow windows"
              : "The signal starts here."
          }
          text={
            search || filter !== "all"
              ? "Try a different search or verdict filter."
              : "Connect your SDN collector to see measured IPv4 flow windows, rates, and model verdicts."
          }
          action={
            !user ? (
              <button
                className="text-button"
                onClick={() => setLoginOpen(true)}
              >
                Connect your workspace <ArrowRight size={14} />
              </button>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );

  return (
    <div className={`app-shell ${reduced ? "motion-off" : ""}`}>
      <motion.div
        className="scroll-progress"
        aria-hidden="true"
        style={{ scaleX: reduced ? 0 : pageProgress }}
      />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <a
          className="brand"
          href="#overview"
          onClick={() => navigate("overview")}
          aria-label="Sentinel overview"
        >
          <span className="brand-mark">
            <Shield size={24} strokeWidth={1.6} />
            <i />
          </span>
          <span>
            SENTINEL<small>SDN DEFENSE SYSTEM</small>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-icon">
            <Network size={16} />
          </span>
          <div>
            {data?.workspace?.name ?? "Network workspace"}
            <small>{user ? user.role : "Not connected"}</small>
          </div>
          <ChevronDown size={13} />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {sections.slice(0, 4).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${section === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.5} />
              <span>{label}</span>
              {id === "incidents" && openIncidents > 0 ? (
                <b>{openIncidents}</b>
              ) : null}
              {id === "overview" ? <span className="nav-key">01</span> : null}
            </button>
          ))}
        </nav>
        <p className="nav-caption second">OPERATIONS</p>
        <nav aria-label="Operations navigation">
          {sections.slice(4).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${section === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={17} strokeWidth={1.5} />
              <span>{label}</span>
              {id === "intelligence" ? (
                <span className="mini-label">ML</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-card">
            <span className="engine-icon">
              <Cpu size={17} />
            </span>
            <div>
              Detection engine
              <small>
                <i
                  className={
                    data?.model.ready ? "status-dot green" : "status-dot"
                  }
                />
                {data?.model.ready ? "Model loaded" : "Awaiting model"}
              </small>
            </div>
            <span className="engine-version">ML</span>
          </div>
          <button className="nav-item" onClick={() => setGuideOpen(true)}>
            <BookOpen size={17} strokeWidth={1.5} />
            <span>Connection guide</span>
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <a href="/" className="workspace-home-link">
              ← Sentinel home
            </a>
            <span className="version">SENTINEL / 1.3</span>
            <span className="footer-dot" />{" "}
            <span>OBSERVE. UNDERSTAND. DEFEND.</span>
          </div>
        </div>
      </aside>
      {mobileNav ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-root">Workspace</span>
            <ChevronRight size={13} />
            <span>{sections.find((s) => s.id === section)?.label}</span>
          </div>
          <div className="topbar-actions">
            <span
              className={`stream-state ${connection === "live" ? "connected" : ""}`}
            >
              <i />
              {connection === "live"
                ? "Console connected"
                : connection === "connecting"
                  ? "Connecting"
                  : connection === "reconnecting"
                    ? "Reconnecting"
                    : "Workspace offline"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button motion-toggle"
              onClick={() => {
                try {
                  localStorage.setItem(
                    "sentinel.motion-off",
                    String(!motionOff),
                  );
                } catch {
                  /* Keep the preference in memory when storage is unavailable. */
                }
                setMotionOff(!motionOff);
              }}
              aria-label={
                reduced
                  ? "Enable motion (respects system preferences)"
                  : "Pause motion"
              }
              aria-pressed={motionOff}
            >
              {reduced ? <Pause size={16} /> : <Activity size={16} />}
            </button>
            <button
              className="icon-button notification-button"
              aria-label={`Open incidents, ${openIncidents} unresolved`}
              onClick={() => navigate("incidents")}
            >
              <Bell size={17} />
              {openIncidents ? <i /> : null}
            </button>
            {user ? (
              <button
                className="profile-button"
                onClick={() => network.logout()}
                title={`Sign out ${user.email}`}
                aria-label={`Sign out ${user.email}`}
              >
                <span>{user.email.slice(0, 2).toUpperCase()}</span>
                <LogOut size={14} />
              </button>
            ) : (
              <button
                className="sign-in-button"
                onClick={() => setLoginOpen(true)}
              >
                Sign in <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <div className="eyebrow page-eyebrow">
                <span className="small-cross">+</span> OBSERVABILITY & DEFENSE
              </div>
              <h1>{titles[section][0]}</h1>
              <p>{titles[section][1]}</p>
            </div>
            <div className="page-actions">
              <button
                className="button secondary"
                onClick={() => setGuideOpen(true)}
              >
                <CircleHelp size={15} />
                Setup guide
              </button>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={download}
              >
                {busy === "export" ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
                Export flows
              </button>
            </div>
          </div>
          {error || (data && connection !== "live") ? (
            <div className="connection-warning" role="status">
              <TriangleAlert size={16} />
              <span>
                {error || "Live connection interrupted."}{" "}
                {data
                  ? `Showing the last received snapshot from ${time(data.timestamp)}. Status and counters may be stale.`
                  : ""}
              </span>
            </div>
          ) : null}
          {token && connection === "connecting" ? (
            <div
              className="loader-track"
              role="status"
              aria-label="Connecting to your network"
            />
          ) : null}
          {token &&
          data &&
          data.collectors.length > 0 &&
          !onlineCollectors.length ? (
            <div className="connection-warning" role="status">
              <Radio size={16} />
              <span>
                No collector is reporting current measurements. The console
                connection remains active; last known infrastructure is marked
                offline.
              </span>
            </div>
          ) : null}
          {data?.workspace ? (
            <div
              className="workspace-source"
              aria-label="Workspace data source"
            >
              <div>
                <ShieldCheck size={16} />
                <strong>{data.workspace.name}</strong>
                <span>
                  {data.workspace.kind === "research_lab"
                    ? "Existing research lab"
                    : "Private network workspace"}
                </span>
              </div>
              <p>
                {data.collectors.length
                  ? `${onlineCollectors.length} reporting / ${data.collectors.length} registered collector${data.collectors.length === 1 ? "" : "s"} · ${data.summary.last_flow ? `last measured flow ${time(data.summary.last_flow)}` : "no measured flow in this time range"}`
                  : "No network connected · this workspace has no inherited telemetry"}
              </p>
              <button className="text-button" onClick={() => navigate("setup")}>
                Manage connection <ArrowRight size={14} />
              </button>
              {data.collectors.length ? (
                <div className="source-collectors">
                  {data.collectors.slice(0, 6).map((c) => (
                    <span key={c.id}>
                      {c.id} ·{" "}
                      {c.source_type === "isolated_lab"
                        ? "Isolated Mininet lab"
                        : "SDN controller"}{" "}
                      ·{" "}
                      {c.online
                        ? c.controller_status === "connected"
                          ? "reporting"
                          : "controller unreachable"
                        : "offline"}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {section === "intelligence" &&
          reports.some((r) => r.status !== "complete") ? (
            <div className="operation-message" role="status">
              {reports.filter((r) => r.status === "pending").length} analyses in
              progress · {reports.filter((r) => r.status === "failed").length}{" "}
              provider requests failed. Detection operates independently.
            </div>
          ) : null}
          <AnimatePresence mode="wait">
            <motion.div
              key={section}
              initial={{ opacity: 0, y: reduced ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {section === "setup" && token && user && data ? (
                <NetworkSetup
                  token={token}
                  user={user}
                  data={data}
                  refresh={network.refresh}
                />
              ) : null}
              {section === "overview" ? (
                <>
                  {token && user && data && !data.collectors.length ? (
                    <NetworkSetup
                      token={token}
                      user={user}
                      data={data}
                      refresh={network.refresh}
                    />
                  ) : null}
                  <section
                    className="hero-panel"
                    ref={heroRef}
                    hidden={!!data && !data.collectors.length}
                  >
                    <div className="hero-grid" />
                    <div className="hero-topline">
                      <span>
                        <i />
                        <span className="type-label">
                          INTELLIGENT NETWORK DEFENSE
                        </span>
                      </span>
                      <span className="hero-index">SYSTEM / 001</span>
                    </div>
                    <div className="hero-copy">
                      <h2>
                        See the signal.
                        <br />
                        <span>Stop the surge.</span>
                      </h2>
                      <p>
                        Machine learning meets network intelligence.
                        <br />
                        Your software defined network, one step ahead.
                      </p>
                      <div className="hero-actions">
                        <button
                          className="button primary"
                          onClick={() =>
                            user ? navigate("traffic") : setLoginOpen(true)
                          }
                        >
                          {user
                            ? "Explore live traffic"
                            : "Connect your network"}
                          <ArrowUpRight size={16} />
                        </button>
                        <button
                          className="hero-link"
                          onClick={() =>
                            document
                              .getElementById("telemetry")
                              ?.scrollIntoView({
                                behavior: reduced ? "instant" : "smooth",
                              })
                          }
                        >
                          Explore workspace <ArrowDown size={14} />
                        </button>
                      </div>
                    </div>
                    <motion.div
                      className="hero-scene"
                      style={{ y: sceneY }}
                      aria-hidden="true"
                    >
                      <Suspense
                        fallback={
                          <div className="scene-fallback">
                            <span />
                            <span />
                            <span />
                          </div>
                        }
                      >
                        <NetworkScene reduced={reduced} />
                      </Suspense>
                    </motion.div>
                    <div className="scene-label">
                      <span className="scene-cross">+</span>
                      <div>
                        ADAPTIVE DEFENSE MESH
                        <small>Conceptual network geometry</small>
                      </div>
                    </div>
                    <div className="hero-bottom">
                      <span>
                        <Fingerprint size={14} /> BUILT FOR THE UNEXPECTED
                      </span>
                      <div className="pipeline">
                        <span>COLLECT</span>
                        <i />
                        <span>DETECT</span>
                        <i />
                        <span>DEFEND</span>
                      </div>
                    </div>
                  </section>
                  <div className="telemetry-heading" id="telemetry">
                    <span className="eyebrow">
                      <Radio size={13} /> NETWORK PULSE
                    </span>
                    <span className="muted tiny">
                      {data
                        ? data.summary.last_flow
                          ? `Last flow ${time(data.summary.last_flow)}`
                          : "Awaiting measured traffic"
                        : "Waiting for a secure connection"}
                      <i className="inline-dot" />
                      60-second rate window
                    </span>
                  </div>
                  <div className="metrics-grid">
                    {[
                      {
                        label: "Observed throughput",
                        value:
                          data && (data.workspace?.has_measurements ?? true)
                            ? compact(
                                Number(data.summary.bits_per_second),
                                "bps",
                              )
                            : "—",
                        caption: "Across monitored flow entries",
                        icon: Activity,
                        tag: "TRAFFIC",
                      },
                      {
                        label: "Packet rate",
                        value:
                          data && (data.workspace?.has_measurements ?? true)
                            ? compact(
                                Number(data.summary.packets_per_second),
                                "pps",
                              )
                            : "—",
                        caption: "Measured over the last 60 seconds",
                        icon: Zap,
                        tag: "TELEMETRY",
                      },
                      {
                        label: "Open incidents",
                        value:
                          data && (data.workspace?.has_measurements ?? true)
                            ? String(openIncidents).padStart(2, "0")
                            : "—",
                        caption: data?.model.ready
                          ? "Unresolved model detections"
                          : "Classification awaits a trained model",
                        icon: Shield,
                        tag: "DETECTION",
                      },
                      {
                        label: "Connected switches",
                        value:
                          data && data.collectors.length > 0
                            ? String(switchCount).padStart(2, "0")
                            : "—",
                        caption: data
                          ? `${onlineCollectors.length} reporting collector${onlineCollectors.length === 1 ? "" : "s"}`
                          : "Discover through your controller",
                        icon: Network,
                        tag: "NETWORK",
                      },
                    ].map(({ label, value, caption, icon: Icon, tag }, i) => (
                      <motion.div
                        className="metric-card"
                        key={label}
                        whileHover={reduced ? undefined : { y: -3 }}
                      >
                        <div className="metric-top">
                          <Icon size={17} strokeWidth={1.4} />
                          <span>{tag}</span>
                          <span className="metric-index">0{i + 1}</span>
                        </div>
                        <p>{label}</p>
                        <div className="metric-value">{value}</div>
                        <small>{caption}</small>
                      </motion.div>
                    ))}
                  </div>
                  <div className="overview-middle">
                    <section className="panel traffic-panel">
                      <PanelHeading
                        eyebrow="TELEMETRY"
                        title="Traffic overview"
                        action={
                          <div className="range-select">
                            <select
                              aria-label="Traffic time window"
                              value={minutes}
                              onChange={(e) =>
                                setMinutes(Number(e.target.value))
                              }
                            >
                              {[5, 15, 30, 60].map((m) => (
                                <option value={m} key={m}>
                                  Last {m} minutes
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={12} />
                          </div>
                        }
                      />
                      <div className="chart-legend">
                        <span>
                          <i className="amber" />
                          Observed traffic
                        </span>
                        <span>
                          <i className="red" />
                          ML attack traffic
                        </span>
                        <span className="legend-note">30s buckets</span>
                      </div>
                      <TrafficChart data={data} />
                      <div className="panel-footer">
                        <span>
                          <span
                            className={
                              liveTelemetry ? "status-dot green" : "status-dot"
                            }
                          />
                          {liveTelemetry
                            ? "Collector reporting"
                            : "Awaiting telemetry"}
                        </span>
                        <button
                          className="text-button"
                          onClick={() => navigate("traffic")}
                        >
                          Inspect traffic <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </section>
                    <section className="panel topology-panel">
                      <PanelHeading
                        eyebrow="INFRASTRUCTURE"
                        title="Network map"
                        action={
                          <button
                            className="icon-button"
                            aria-label="Open network topology"
                            onClick={() => navigate("topology")}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        }
                      />
                      <Topology data={data} />
                    </section>
                  </div>
                  <div className="overview-lower">
                    <section className="panel flows-panel">
                      <PanelHeading
                        eyebrow="FLOW INTELLIGENCE"
                        title="Latest observations"
                        action={
                          <button
                            className="text-button"
                            onClick={() => navigate("traffic")}
                          >
                            View all <ArrowRight size={14} />
                          </button>
                        }
                      />
                      {flowTable(5)}
                    </section>
                    <section className="panel model-card">
                      <div className="model-card-top">
                        <div className="model-logo">
                          <Cpu size={24} strokeWidth={1.1} />
                        </div>
                        <span className="mini-label">ML ENGINE</span>
                      </div>
                      <p className="eyebrow">THE INTELLIGENCE LAYER</p>
                      <h2>
                        Precision begins
                        <br />
                        with evidence.
                      </h2>
                      <p className="model-description">
                        A tree ensemble model classifies measured flow behavior.
                        Every verdict stays traceable to its model version.
                      </p>
                      <div className="model-status-row">
                        <span>Classifier</span>
                        <strong>
                          {data?.model.metadata?.algorithm ?? "Not installed"}
                        </strong>
                      </div>
                      <div className="model-status-row">
                        <span>Model status</span>
                        <Badge tone={data?.model.ready ? "success" : "neutral"}>
                          {data?.model.ready ? "Loaded" : "Not installed"}
                        </Badge>
                      </div>
                      <button
                        className="button model-button"
                        onClick={() => navigate("intelligence")}
                      >
                        Explore intelligence <ArrowUpRight size={15} />
                      </button>
                    </section>
                  </div>
                </>
              ) : null}
              {section === "traffic" ? (
                <>
                  <section className="panel">
                    <PanelHeading
                      eyebrow="MEASURED FLOW WINDOWS"
                      title="Traffic telemetry"
                      action={
                        <Badge tone={liveTelemetry ? "success" : "neutral"}>
                          {liveTelemetry
                            ? "Collector reporting"
                            : "Awaiting collector"}
                        </Badge>
                      }
                    />
                    <TrafficChart data={data} />
                  </section>
                  <section className="panel section-gap">
                    <div className="table-toolbar">
                      <div className="search-input">
                        <Search size={16} />
                        <input
                          aria-label="Search flows"
                          placeholder="Search IP, switch, or protocol…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <select
                        className="filter-select"
                        aria-label="Filter verdict"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All verdicts</option>
                        <option value="attack">Attack</option>
                        <option value="benign">Benign</option>
                        <option value="unclassified">Unclassified</option>
                      </select>
                    </div>
                    {flowTable()}
                    <div className="panel-footer">
                      <span>
                        Latest {data?.flows.length ?? 0} flow windows · last{" "}
                        {minutes} minutes
                      </span>
                      <button className="text-button" onClick={download}>
                        Export CSV <ArrowDownToLine size={13} />
                      </button>
                    </div>
                  </section>
                  <p className="footnote">
                    Rates summarize observed switch entries. Traffic traversing
                    multiple monitored switches can be counted at each hop;
                    select ingress switches in the collector for perimeter
                    throughput.
                  </p>
                </>
              ) : null}
              {section === "traffic" && token ? (
                <FlowHistory token={token} />
              ) : null}
              {section === "topology" ? (
                <section className="panel">
                  <PanelHeading
                    eyebrow="CONTROLLER DISCOVERY"
                    title="Observed infrastructure"
                    action={
                      <Badge tone={liveTelemetry ? "success" : "neutral"}>
                        {switchCount} connected switches
                      </Badge>
                    }
                  />
                  <Topology data={data} large />
                  <div className="collector-list">
                    {data?.collectors.length ? (
                      data.collectors.map((c) => (
                        <div className="collector-row" key={c.id}>
                          <Server size={21} />
                          <div>
                            <strong>{c.id}</strong>
                            <small>
                              {c.switches.length} reported switches · v
                              {c.version}
                            </small>
                          </div>
                          <Badge
                            tone={
                              c.online && c.controller_status === "connected"
                                ? "success"
                                : "neutral"
                            }
                          >
                            {c.online ? c.controller_status : "Offline"}
                          </Badge>
                          <span className="mono muted">
                            {time(c.last_seen)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="footnote">
                        No topology is inferred from decorative geometry.
                        Switches appear only after a collector reports
                        controller discovery.
                      </p>
                    )}
                  </div>
                </section>
              ) : null}
              {section === "incidents" ? (
                <>
                  <div className="incident-summary">
                    <div>
                      <Shield size={20} />
                      <span>
                        <strong>{data ? openIncidents : "—"}</strong> unresolved
                        incidents
                      </span>
                    </div>
                    <p>
                      Detection is advisory. Blocking requires operator review
                      and switch verification.
                    </p>
                  </div>
                  <section className="panel">
                    <div className="table-toolbar">
                      <div className="search-input">
                        <Search size={16} />
                        <input
                          aria-label="Search incidents"
                          placeholder="Search incident or IP address…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <select
                        className="filter-select"
                        aria-label="Incident status"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All statuses</option>
                        <option value="open">Open</option>
                        <option value="acknowledged">Acknowledged</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </div>
                    {filteredIncidents.length ? (
                      <div className="incident-list">
                        {filteredIncidents.map((i) => (
                          <button
                            className="incident-row"
                            onClick={() => openIncident(i)}
                            key={i.id}
                          >
                            <span className="incident-icon">
                              <TriangleAlert size={20} />
                            </span>
                            <div>
                              <strong>Suspected DDoS activity</strong>
                              <span className="mono">
                                {i.source_ip} → {i.destination_ip}
                              </span>
                              <small>
                                {protocolName(i.protocol)} · SW-{i.switch_id} ·{" "}
                                {time(i.last_seen)}
                              </small>
                            </div>
                            <div className="incident-score">
                              <strong>
                                {(i.probability * 100).toFixed(1)}%
                              </strong>
                              <small>model probability</small>
                            </div>
                            <Badge
                              tone={
                                i.status === "resolved" ? "success" : "danger"
                              }
                            >
                              {i.status}
                            </Badge>
                            <ChevronRight size={17} />
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<ShieldCheck size={32} strokeWidth={1} />}
                        title={
                          search || filter !== "all"
                            ? "No matching incidents"
                            : "No detections to review"
                        }
                        text={
                          data?.model.ready
                            ? "Incidents appear when measured flows cross the configured probability and packet thresholds."
                            : "Install a validated model and connect a collector to begin detection. An empty incident list does not establish that a network is safe."
                        }
                      />
                    )}
                  </section>
                  <section className="panel section-gap">
                    <PanelHeading
                      eyebrow="CONTROL PLANE"
                      title="Mitigation activity"
                    />
                    {data?.commands.length ? (
                      <div className="command-list">
                        {data.commands.map((c) => (
                          <div className="command-row" key={c.id}>
                            <Shield size={17} />
                            <div>
                              <strong>
                                {c.kind === "block"
                                  ? "Scoped flow block"
                                  : "Rule revocation"}
                              </strong>
                              <small>
                                {c.detail ??
                                  "Awaiting collector acknowledgement"}
                              </small>
                            </div>
                            <Badge
                              tone={
                                c.status === "enforced"
                                  ? "success"
                                  : c.status === "failed"
                                    ? "danger"
                                    : "neutral"
                              }
                            >
                              {c.status}
                            </Badge>
                            {canOperate &&
                            c.kind === "block" &&
                            c.status === "enforced" ? (
                              <button
                                className="button secondary small"
                                disabled={!!busy}
                                onClick={() =>
                                  action(
                                    c.id,
                                    () =>
                                      request(
                                        `/api/commands/${c.id}/revoke`,
                                        token,
                                        { method: "POST" },
                                      ),
                                    "Revocation queued. Awaiting switch verification.",
                                  )
                                }
                              >
                                Revoke
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        title="No mitigation commands"
                        text="Operator-requested rules and their actual controller outcomes will appear here."
                      />
                    )}
                  </section>
                </>
              ) : null}
              {section === "intelligence" ? (
                <div className="intelligence-grid">
                  <section className="panel">
                    <PanelHeading
                      eyebrow="MODEL REGISTRY"
                      title="Detection engine"
                      action={
                        <Badge tone={data?.model.ready ? "success" : "neutral"}>
                          {data?.model.ready ? "Loaded" : "Awaiting model"}
                        </Badge>
                      }
                    />
                    <div className="model-detail">
                      <div className="model-orbit">
                        <Cpu size={36} strokeWidth={1} />
                      </div>
                      <h3>
                        {data?.model.metadata?.algorithm ?? "Detection"}{" "}
                        classifier
                      </h3>
                      <p>
                        Five measured flow features. Group-held-out evaluation.
                        A versioned artifact with a verified SHA-256. Shared
                        pretrained research model; these metrics describe its
                        public evaluation, not the accuracy of your network.
                      </p>
                      {data?.model.metadata ? (
                        <>
                          <div className="model-stat-grid">
                            <div>
                              <small>ROC AUC · holdout</small>
                              <strong>
                                {data.model.metadata.roc_auc.toFixed(4)}
                              </strong>
                            </div>
                            <div>
                              <small>Average precision</small>
                              <strong>
                                {data.model.metadata.average_precision.toFixed(
                                  4,
                                )}
                              </strong>
                            </div>
                            <div>
                              <small>Dataset rows · all partitions</small>
                              <strong>
                                {data.model.metadata.rows.toLocaleString()}
                              </strong>
                            </div>
                            <div>
                              <small>Decision threshold</small>
                              <strong>
                                {(data.model.threshold * 100).toFixed(1)}%
                              </strong>
                            </div>
                            <div>
                              <small>Attack precision · holdout</small>
                              <strong>
                                {(
                                  data.model.metadata.classification_report["1"]
                                    .precision * 100
                                ).toFixed(1)}
                                %
                              </strong>
                            </div>
                            <div>
                              <small>Attack recall · holdout</small>
                              <strong>
                                {(
                                  data.model.metadata.classification_report["1"]
                                    .recall * 100
                                ).toFixed(1)}
                                %
                              </strong>
                            </div>
                          </div>
                          <p className="footnote">
                            {data.model.metadata.limitations}
                          </p>
                          {data.model.metadata.cross_validation?.length ? (
                            <p className="footnote">
                              Across training-group validation folds, attack
                              recall ranged{" "}
                              {Math.min(
                                ...data.model.metadata.cross_validation.map(
                                  (f) => f.recall * 100,
                                ),
                              ).toFixed(1)}
                              –
                              {Math.max(
                                ...data.model.metadata.cross_validation.map(
                                  (f) => f.recall * 100,
                                ),
                              ).toFixed(1)}
                              %. Performance varies by traffic family; validate
                              your network before enforcement.
                            </p>
                          ) : null}
                          <p className="mono tiny">
                            {data.model.metadata.version}
                          </p>
                        </>
                      ) : (
                        <div className="model-await">
                          <LockKeyhole size={17} />
                          <p>
                            {data?.model.error ??
                              "No verified model is installed. Train on labeled SDN capture windows and deploy the artifact before enabling classification."}
                          </p>
                        </div>
                      )}
                      <div className="feature-list">
                        {(
                          data?.model.features ?? [
                            "packet_rate",
                            "byte_rate",
                            "mean_packet_size",
                            "duration_seconds",
                            "protocol",
                          ]
                        ).map((feature, i) => (
                          <div key={feature}>
                            <span className="mono muted">0{i + 1}</span>
                            <span>{feature.replaceAll("_", " ")}</span>
                            {data?.model.metadata ? (
                              <span className="mono">
                                {(
                                  data.model.metadata.feature_importance[
                                    feature
                                  ] * 100
                                ).toFixed(1)}
                                %
                              </span>
                            ) : (
                              <span className="muted">Input feature</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                  <section className="panel">
                    <PanelHeading
                      eyebrow="OPENROUTER / FREE"
                      title="Incident intelligence"
                      action={<Sparkles size={19} className="amber-text" />}
                    />
                    <div className="intelligence-copy">
                      <h3>Context for the next move.</h3>
                      <p>
                        Turn measured incident evidence into a concise
                        investigation brief. AI analysis never changes detection
                        or installs network rules.
                      </p>
                      <Badge
                        tone={data?.integrations.ai ? "success" : "neutral"}
                      >
                        {data?.integrations.ai
                          ? "API key configured"
                          : "API key required"}
                      </Badge>
                    </div>
                    {data?.incidents.length ? (
                      <div className="ai-select-list">
                        {data.incidents.slice(0, 8).map((i) => (
                          <button
                            key={i.id}
                            onClick={() => {
                              setAnalysisId(i.id);
                              setReport("");
                              void explain(i);
                            }}
                            disabled={
                              !!busy || !canOperate || !data.integrations.ai
                            }
                          >
                            <Shield size={17} />
                            <span>
                              {i.source_ip}
                              <small>
                                {time(i.last_seen)} ·{" "}
                                {(i.probability * 100).toFixed(1)}% probability
                              </small>
                            </span>
                            {busy === "explain" && analysisId === i.id ? (
                              <LoaderCircle size={17} className="spin" />
                            ) : (
                              <ArrowUpRight size={16} />
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Sparkles size={28} strokeWidth={1} />}
                        title="Evidence comes first."
                        text="Select a real incident here when detections are available. Analysis uses counts and model evidence; IP addresses and operator notes stay on your backend."
                      />
                    )}
                    {report ? (
                      <div className="ai-report">
                        <p className="eyebrow">
                          GENERATED ANALYSIS · VERIFY BEFORE ACTING
                        </p>
                        <p>{report}</p>
                      </div>
                    ) : null}
                    {reports
                      .filter((r) => r.status === "complete")
                      .slice(0, 5)
                      .map((r) => (
                        <details className="saved-report" key={r.id}>
                          <summary>
                            Saved analysis <span>{time(r.created_at)}</span>
                          </summary>
                          <p>{r.content}</p>
                        </details>
                      ))}
                    <div className="panel-footer">
                      <span>
                        Free provider quotas apply. Detection works
                        independently.
                      </span>
                    </div>
                  </section>
                </div>
              ) : null}
              {section === "system" && token && user ? (
                <WorkspaceControls
                  token={token}
                  user={user}
                  revision={data?.revision ?? ""}
                  onLogout={network.logout}
                />
              ) : null}
              {section === "system" ? (
                <>
                  <div className="settings-grid">
                    <section className="panel">
                      <PanelHeading
                        eyebrow="INTEGRATIONS"
                        title="Connection health"
                      />
                      <div className="integration-list">
                        {[
                          {
                            icon: Database,
                            name: "PostgreSQL",
                            text: "Persistent flows, incidents, and audit history",
                            value: data?.integrations.database
                              ? "Connected"
                              : "Not verified",
                            ok: data?.integrations.database,
                          },
                          {
                            icon: Radio,
                            name: "SDN collector",
                            text: `${onlineCollectors.length} reporting · OpenFlow 1.3 flow counters`,
                            value: liveTelemetry
                              ? "Reporting"
                              : "Awaiting collector",
                            ok: liveTelemetry,
                          },
                          {
                            icon: Cpu,
                            name: "Machine learning",
                            text:
                              data?.model.metadata?.version ??
                              "Install a trained, verified artifact",
                            value: data?.model.ready
                              ? "Model loaded"
                              : "Not installed",
                            ok: data?.model.ready,
                          },
                          {
                            icon: Sparkles,
                            name: "OpenRouter",
                            text: "Optional incident analysis · free router",
                            value: data?.integrations.ai
                              ? "Key configured"
                              : "Not configured",
                            ok: data?.integrations.ai,
                          },
                          {
                            icon: Shield,
                            name: "Manual mitigation",
                            text: "Scoped 300-second rules · switch verification",
                            value: data?.integrations.mitigation
                              ? "Enabled"
                              : "Disabled",
                            ok: data?.integrations.mitigation,
                          },
                        ].map(({ icon: Icon, name, text, value, ok }) => (
                          <div className="integration-row" key={name}>
                            <div className="integration-icon">
                              <Icon size={20} strokeWidth={1.3} />
                            </div>
                            <div>
                              <strong>{name}</strong>
                              <small>{text}</small>
                            </div>
                            <Badge tone={ok ? "success" : "neutral"}>
                              {value}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <PanelHeading
                        eyebrow="WORKSPACE"
                        title="Access & environment"
                      />
                      <div className="settings-content">
                        <label>API endpoint</label>
                        <code>{API || window.location.origin}</code>
                        <label>Current identity</label>
                        <p>{user?.email ?? "Not signed in"}</p>
                        <label>Access level</label>
                        <p>{user?.role ?? "Public workspace preview"}</p>
                        <label>Motion preference</label>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setMotionOff(!motionOff);
                            try {
                              localStorage.setItem(
                                "sentinel.motion-off",
                                String(!motionOff),
                              );
                            } catch {
                              /* In-memory preference remains available. */
                            }
                          }}
                        >
                          {reduced ? (
                            <Pause size={15} />
                          ) : (
                            <Activity size={15} />
                          )}
                          {reduced ? "Motion reduced" : "Motion enabled"}
                        </button>
                        <p className="footnote">
                          System reduced-motion preferences are always
                          respected.
                        </p>
                        <button
                          className="button primary"
                          onClick={() =>
                            user ? network.logout() : setLoginOpen(true)
                          }
                        >
                          {user ? "Sign out" : "Sign in"}
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </section>
                  </div>
                  <section className="panel section-gap">
                    <PanelHeading
                      eyebrow="ACCOUNTABILITY"
                      title="Audit trail"
                    />
                    {data?.audit.length ? (
                      <div className="audit-list">
                        {data.audit.map((a) => (
                          <div key={a.id}>
                            <span className="audit-dot" />
                            <span>{a.action.replaceAll(".", " / ")}</span>
                            <small className="mono">
                              {a.resource.slice(0, 12)}
                            </small>
                            <time>{time(a.created_at)}</time>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty
                        icon={<Eye size={26} strokeWidth={1} />}
                        title="Actions leave a trace."
                        text="Sign-ins, incident updates, mitigation requests, and AI analysis are recorded in PostgreSQL."
                      />
                    )}
                  </section>
                </>
              ) : null}
            </motion.div>
          </AnimatePresence>
          <footer className="main-footer">
            <div>
              <span className="footer-brand">S /</span>
              <span>Machine Learning-Based DDoS Attack Detection in SDN</span>
            </div>
            <span>
              VISIBILITY IS YOUR FIRST DEFENSE{" "}
              <span className="small-cross">+</span>
            </span>
          </footer>
        </main>
      </div>
      <AnimatePresence>
        {loginOpen ? (
          <Modal
            title="Connect to your workspace"
            onClose={() => setLoginOpen(false)}
          >
            <div className="login-intro">
              <span className="login-mark">
                <Shield size={25} />
              </span>
              <p>
                Your network. Your control.
                <small>
                  Sign in with an account created by your administrator.
                </small>
              </p>
            </div>
            <form onSubmit={signIn}>
              <label className="form-label" htmlFor="email">
                Email address
              </label>
              <input
                className="form-input"
                id="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organization.com"
                required
              />
              <label className="form-label" htmlFor="password">
                Password
              </label>
              <input
                className="form-input"
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              {loginError ? (
                <p className="form-error" role="alert">
                  {loginError}
                </p>
              ) : null}
              <button
                className="button primary full"
                type="submit"
                disabled={busy === "login"}
              >
                {busy === "login" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <LockKeyhole size={15} />
                )}
                Secure sign in <ArrowRight size={16} />
              </button>
            </form>
            <p className="footnote login-note">
              Need an account? Ask your workspace administrator for access.
              Create a private workspace at /auth/register, or ask your
              workspace administrator for a team account.
            </p>
          </Modal>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {guideOpen ? (
          <Modal
            wide
            title="Bring your network online"
            onClose={() => setGuideOpen(false)}
          >
            {token && user && data ? (
              <NetworkSetup
                token={token}
                user={user}
                data={data}
                refresh={network.refresh}
              />
            ) : (
              <p className="guide-intro">
                Sign in to configure your private workspace connection.
              </p>
            )}
          </Modal>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {selectedLatest ? (
          <Modal
            wide
            title="Incident investigation"
            onClose={() => setSelected(null)}
          >
            <div className="incident-modal-top">
              <Badge
                tone={
                  selectedLatest.status === "resolved" ? "success" : "danger"
                }
              >
                {selectedLatest.status}
              </Badge>
              <span className="mono muted tiny">
                {selectedLatest.id.slice(0, 8)}
              </span>
            </div>
            <h3 className="incident-title">Suspected DDoS activity</h3>
            <p className="incident-ip mono">
              {selectedLatest.source_ip} <ArrowRight size={17} />{" "}
              {selectedLatest.destination_ip}
            </p>
            <div className="incident-evidence">
              <div>
                <small>Attack probability</small>
                <strong>
                  {(selectedLatest.probability * 100).toFixed(1)}%
                </strong>
              </div>
              <div>
                <small>Observed packets</small>
                <strong>{compact(selectedLatest.packets)}</strong>
              </div>
              <div>
                <small>Protocol / switch</small>
                <strong>
                  {protocolName(selectedLatest.protocol)} /{" "}
                  {selectedLatest.switch_id}
                </strong>
              </div>
            </div>
            <p className="footnote">
              Model: {selectedLatest.model_version} · first seen{" "}
              {time(selectedLatest.first_seen)} · last seen{" "}
              {time(selectedLatest.last_seen)}. Probability is a model estimate
              and requires investigation.
            </p>
            {selected && selected.revision !== selectedLatest.revision ? (
              <p className="operation-message" role="status">
                This incident changed in another session. Close and reopen it to
                review the latest notes before saving.
              </p>
            ) : null}
            <label className="form-label" htmlFor="assignee">
              Assigned investigator
            </label>
            <select
              id="assignee"
              className="form-input"
              disabled={!canOperate}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {assignable
                .filter(
                  (u) =>
                    u.active && u.approved !== false && u.role !== "viewer",
                )
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))}
            </select>
            <label className="form-label" htmlFor="notes">
              Investigation notes
            </label>
            <textarea
              id="notes"
              className="form-input"
              rows={3}
              maxLength={2000}
              value={notes}
              disabled={!canOperate}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record the evidence and your response…"
            />
            <button
              className="button secondary"
              disabled={!!busy || !canOperate}
              onClick={() =>
                action(
                  "save-notes",
                  () =>
                    request(`/api/incidents/${selectedLatest.id}`, token, {
                      method: "PATCH",
                      body: JSON.stringify({
                        status: selectedLatest.status,
                        notes,
                        revision: selected?.revision ?? selectedLatest.revision,
                        assignee_id: assignee || null,
                      }),
                    }),
                  "Investigation notes and ownership saved.",
                )
              }
            >
              Save investigation
            </button>
            <div className="incident-actions">
              <button
                className="button secondary"
                disabled={!!busy || !canOperate}
                onClick={() =>
                  action(
                    "ack",
                    () =>
                      request(`/api/incidents/${selectedLatest.id}`, token, {
                        method: "PATCH",
                        body: JSON.stringify({
                          status: "acknowledged",
                          notes,
                          revision:
                            selected?.revision ?? selectedLatest.revision,
                          assignee_id: assignee || null,
                        }),
                      }),
                    "Incident acknowledged and notes saved.",
                  )
                }
              >
                <CheckCheck size={15} />
                Acknowledge
              </button>
              <button
                className="button secondary"
                disabled={!!busy || !canOperate}
                onClick={() =>
                  action(
                    "resolve",
                    () =>
                      request(`/api/incidents/${selectedLatest.id}`, token, {
                        method: "PATCH",
                        body: JSON.stringify({
                          status: "resolved",
                          notes,
                          revision:
                            selected?.revision ?? selectedLatest.revision,
                          assignee_id: assignee || null,
                        }),
                      }),
                    "Incident resolved. Active rules retain their own expiry.",
                  )
                }
              >
                <Check size={15} />
                Resolve
              </button>
              <button
                className="button danger-button"
                disabled={
                  !!busy ||
                  !canOperate ||
                  selectedLatest.status === "resolved" ||
                  !data?.integrations.mitigation
                }
                onClick={() =>
                  action(
                    "mitigate",
                    () =>
                      request(
                        `/api/incidents/${selectedLatest.id}/mitigate`,
                        token,
                        { method: "POST" },
                      ),
                    "Block queued. Check mitigation activity for switch verification.",
                  )
                }
              >
                <Shield size={15} />
                Block flow · 300s
              </button>
            </div>
            <p className="footnote">
              Blocking targets this source, destination, protocol, and observed
              destination port. It requires mitigation enabled on both services.
              Changes are audited.
            </p>
            <button
              className="button secondary full"
              disabled={!!busy || !canOperate || !data?.integrations.ai}
              onClick={() => explain(selectedLatest)}
            >
              {busy === "explain" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Sparkles size={16} />
              )}
              Analyze incident with OpenRouter
            </button>
            {report && analysisId === selectedLatest.id ? (
              <div className="ai-report">
                <p className="eyebrow">AI ANALYSIS · VERIFY BEFORE ACTING</p>
                <p>{report}</p>
              </div>
            ) : null}
          </Modal>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {toast ? (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
          >
            <Radio size={16} />
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="Dismiss message"
              onClick={() => setToast("")}
            >
              <X size={15} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
