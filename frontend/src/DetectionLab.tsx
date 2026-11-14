import { useMemo, useState } from "react";
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight,
  CircleAlert, Database, Layers3, LoaderCircle, Play, RotateCcw, ScanLine,
} from "lucide-react";
import { protocolName, request } from "./api";
import { calculateMetrics, exportCohort, number, outcomeInfo, outcomeOf, percent } from "./benchmark";
import type { BenchmarkRun, BenchmarkWindow, Outcome } from "./benchmark";
import BenchmarkChart from "./components/BenchmarkChart";
import PublicHeader from "./components/PublicHeader";

const perPage = 12;
const outcomes: Outcome[] = ["tp", "fn", "fp", "tn"];
const sourceUrl = "https://data.mendeley.com/datasets/jxpfjc64kr/1";

function WindowInspector({ row, threshold }: { row: BenchmarkWindow; threshold: number }) {
  const [id, label, score, packetRate, byteRate, meanSize, duration, protocol] = row;
  const outcome = outcomeOf(row, threshold);
  return (
    <tr className="bench-inspector">
      <td colSpan={6}>
        <strong>Window {id} · {outcomeInfo[outcome].detail}</strong>
        <p>
          The model score {percent(score)} {score >= threshold ? "meets or exceeds" : "is below"} the {percent(threshold)} decision threshold.
          The published label is {label ? "attack" : "benign"}.
        </p>
        <dl>
          <div><dt>Packet rate</dt><dd>{packetRate.toFixed(2)} pkt/s</dd></div>
          <div><dt>Byte rate</dt><dd>{byteRate.toFixed(2)} B/s</dd></div>
          <div><dt>Mean packet size</dt><dd>{meanSize.toFixed(2)} B</dd></div>
          <div><dt>Flow duration</dt><dd>{duration.toFixed(2)} s</dd></div>
          <div><dt>Protocol</dt><dd>{protocolName(protocol)} ({protocol})</dd></div>
        </dl>
      </td>
    </tr>
  );
}

function Results({ run }: { run: BenchmarkRun }) {
  const [threshold, setThreshold] = useState(run.model.threshold);
  const [protocol, setProtocol] = useState("all");
  const [outcome, setOutcome] = useState<"all" | Outcome>("all");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const cohort = useMemo(
    () => run.windows.filter((row) => protocol === "all" || row[7] === Number(protocol)),
    [protocol, run.windows],
  );
  const metrics = useMemo(() => calculateMetrics(cohort, threshold), [cohort, threshold]);
  const visible = useMemo(
    () => cohort.filter((row) => outcome === "all" || outcomeOf(row, threshold) === outcome),
    [cohort, outcome, threshold],
  );
  const sorted = useMemo(
    () => [...visible].sort((a, b) => Math.abs(a[2] - threshold) - Math.abs(b[2] - threshold) || a[0] - b[0]),
    [threshold, visible],
  );
  const current = sorted.slice(page * perPage, (page + 1) * perPage);

  function resetTable() {
    setPage(0);
    setExpanded(null);
  }

  function changeThreshold(value: number) {
    setThreshold(value);
    resetTable();
  }

  function changeOutcome(value: "all" | Outcome) {
    setOutcome(value);
    resetTable();
  }

  return (
    <>
      <div className="bench-scope">
        <div><span className="bench-complete-dot" /> <strong>Run complete</strong><span>{number(run.dataset.rows)} windows scored in {run.inference_ms} ms</span></div>
        <div className="bench-protocol"><label htmlFor="bench-protocol">Protocol</label>
          <select id="bench-protocol" value={protocol} onChange={(event) => {
            setProtocol(event.target.value);
            resetTable();
          }}>
            <option value="all">All protocols</option>
            <option value="1">ICMP</option>
            <option value="6">TCP</option>
            <option value="17">UDP</option>
          </select>
        </div>
      </div>
      <div className="bench-metrics" aria-label="Benchmark metrics">
        {[
          ["Windows in view", number(cohort.length), "Labeled 30-second windows"],
          ["Attack precision", percent(metrics.precision), "Correct flags / all flags"],
          ["Attack recall", percent(metrics.recall), "Detected attacks / all attacks"],
          ["False-positive rate", percent(metrics.falsePositiveRate), "False alarms / benign windows"],
        ].map(([name, value, detail]) => (
          <article className="bench-panel bench-metric" key={name}>
            <h2>{name}</h2><strong>{value}</strong><p>{detail}</p>
          </article>
        ))}
      </div>
      <div className="bench-analysis">
        <section className="bench-panel">
          <div className="bench-panel-heading">
            <h2>Score distribution</h2>
            <p>Counts by model score and published label. Scores are uncalibrated.</p>
          </div>
          {cohort.length > 0 ? <BenchmarkChart windows={cohort} threshold={threshold} /> :
            <p className="bench-empty">This test partition has no windows for the selected protocol.</p>}
          <div className="bench-threshold">
            <div>
              <label htmlFor="bench-threshold">Decision threshold <strong>{percent(threshold)}</strong></label>
              <button className="research-text-link" type="button" onClick={() => changeThreshold(run.model.threshold)}
                disabled={threshold === run.model.threshold}>
                <RotateCcw size={14} /> Reset
              </button>
            </div>
            <input
              id="bench-threshold" type="range" min="0" max="1" step="0.001"
              value={threshold} onChange={(event) => changeThreshold(Number(event.target.value))}
              aria-valuetext={percent(threshold)}
            />
            <p>Scores at or above the threshold are flagged. This slider only changes the benchmark verdicts.</p>
          </div>
        </section>
        <section className="bench-panel">
          <div className="bench-panel-heading">
            <h2>Confusion matrix</h2>
            <p>Select a cell to inspect matching flow windows.</p>
          </div>
          <div className="bench-matrix" role="group" aria-label="Filter windows by outcome">
            {outcomes.map((key) => (
              <button key={key} type="button" className={key} aria-pressed={outcome === key}
                onClick={() => changeOutcome(outcome === key ? "all" : key)}>
                <span>{outcomeInfo[key].name}</span>
                <strong>{number(metrics.counts[key])}</strong>
                <small>{outcomeInfo[key].detail}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
      <section className="bench-panel bench-windows" aria-labelledby="windows-heading">
        <div className="bench-panel-heading bench-window-heading">
          <div>
            <h2 id="windows-heading">Window evidence</h2>
            <p>Sorted by distance to the selected threshold. Select a window to inspect its five model inputs.</p>
          </div>
          <div className="bench-table-actions">
            <select aria-label="Filter evidence by outcome" value={outcome}
              onChange={(event) => changeOutcome(event.target.value as "all" | Outcome)}>
              <option value="all">All outcomes</option>
              {outcomes.map((key) => <option key={key} value={key}>{outcomeInfo[key].name}</option>)}
            </select>
            <button className="research-button ghost" type="button" disabled={!visible.length}
              onClick={() => exportCohort(run, sorted, threshold)}>
              <ArrowDownToLine size={16} /> Export CSV
            </button>
          </div>
        </div>
        {sorted.length ? (
          <div className="bench-table-scroll" tabIndex={0} role="region" aria-label="Benchmark flow windows">
            <table>
              <thead>
                <tr><th>Window</th><th>Protocol</th><th>Published label</th><th>ML verdict</th><th>Attack score</th><th>Outcome</th></tr>
              </thead>
              <tbody>
                {current.map((row) => {
                  const [id, label, score, , , , , windowProtocol] = row;
                  const result = outcomeOf(row, threshold);
                  const open = expanded === id;
                  return [
                    <tr key={id}>
                      <td>
                        <button className="research-text-link" type="button" aria-expanded={open}
                          onClick={() => setExpanded(open ? null : id)}>
                          #{id} <ChevronRight className={open ? "expanded" : ""} size={14} />
                        </button>
                      </td>
                      <td>{protocolName(windowProtocol)}</td>
                      <td>{label ? "Attack" : "Benign"}</td>
                      <td>{score >= threshold ? "Flagged" : "Benign"}</td>
                      <td className="mono">{percent(score)}</td>
                      <td><span className={`bench-outcome ${result}`}>{outcomeInfo[result].name}</span></td>
                    </tr>,
                    open && <WindowInspector key={`detail-${id}`} row={row} threshold={threshold} />,
                  ];
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="bench-empty">No windows match these filters.</p>}
        <div className="bench-pagination">
          <span>{sorted.length ? `${number(page * perPage + 1)}–${number(page * perPage + current.length)} of ${number(sorted.length)}` : "0 windows"}</span>
          <div>
            <button className="research-button ghost" disabled={page === 0} aria-label="Previous page" onClick={() => {
              setPage(page - 1);
              setExpanded(null);
            }}><ChevronLeft size={17} /></button>
            <button className="research-button ghost" disabled={(page + 1) * perPage >= sorted.length} aria-label="Next page" onClick={() => {
              setPage(page + 1);
              setExpanded(null);
            }}><ChevronRight size={17} /></button>
          </div>
        </div>
      </section>
      <details className="bench-panel bench-provenance">
        <summary>Run provenance <span>{run.model.algorithm} · {run.model.version}</span></summary>
        <dl>
          <div><dt>Model checksum</dt><dd><code>{run.model.sha256}</code></dd></div>
          <div><dt>Test partition checksum</dt><dd><code>{run.dataset.archive_sha256}</code></dd></div>
          <div><dt>Prepared dataset checksum</dt><dd><code>{run.dataset.dataset_sha256}</code></dd></div>
          <div><dt>Reference threshold</dt><dd>{percent(run.model.threshold)}</dd></div>
          <div><dt>Test split</dt><dd>{run.dataset.groups} held-out groups. {run.dataset.split}.</dd></div>
          <div><dt>Run ID</dt><dd><code>{run.id}</code></dd></div>
          <div><dt>Completed at</dt><dd>{new Date(run.completed_at).toISOString()}</dd></div>
          <div><dt>Source</dt><dd>{run.dataset.source.authors.join(", ")}. <a href={run.dataset.source.url}>{run.dataset.source.title}</a> ({run.dataset.source.license}).</dd></div>
        </dl>
      </details>
    </>
  );
}

export default function DetectionLab() {
  const [run, setRun] = useState<BenchmarkRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    setStatus("Scoring the bundled benchmark windows.");
    try {
      const result = await request<BenchmarkRun>("/api/benchmark/run", null, { method: "POST" });
      if (!Array.isArray(result.windows) || result.windows.length !== result.dataset?.rows || !result.model) {
        throw new Error("The API did not return a complete benchmark. Check the backend version and try again.");
      }
      setRun(result);
      setStatus(`Run complete. ${number(result.dataset.rows)} labeled windows scored.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benchmark could not run. Try again.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="research">
      <PublicHeader lab />
      <main className="research-width research-main lab-main">
        <a className="research-text-link bench-back" href="/"><ArrowLeft size={15} /> Project overview</a>
        <section className="research-hero lab-hero" aria-labelledby="lab-heading">
          <div className="research-hero-image" />
          <div className="research-hero-copy">
            <p className="research-eyebrow"><span /> GROUP-HOLDOUT BENCHMARK</p>
            <h1 id="lab-heading">Detection <em>Lab</em></h1>
            <p className="research-hero-description">
              Run the same model used for live SDN telemetry on published, labeled flow windows.
              Inspect every prediction and see how the decision threshold affects errors.
            </p>
            <button className="research-button primary" type="button" onClick={() => void start()} disabled={busy}>
              {busy ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
              {busy ? "Scoring windows…" : run ? "Rerun benchmark" : "Run benchmark"}
            </button>
          </div>
          <div className="bench-dataset">
            <Database size={20} />
            <div><strong>Published Mininet dataset</strong><a href={sourceUrl}>Mendeley Data <ArrowUpRight size={13} /></a></div>
          </div>
        </section>
        <p className="research-sr-only" role="status">{status}</p>
        {error && <p className="bench-error" role="alert"><CircleAlert size={18} />{error}</p>}
        {run ? <Results key={run.id} run={run} /> : (
          <div className="bench-ready">
            <article className="bench-panel"><Layers3 size={23} /><div><h2>Group-held-out test data</h2><p>4,050 measured SDN windows from 30 groups excluded from training and threshold selection.</p></div></article>
            <article className="bench-panel"><ScanLine size={23} /><div><h2>Traceable predictions</h2><p>Explore false alarms and misses, inspect the input features, and export the selected windows as CSV.</p></div></article>
          </div>
        )}
        <footer className="bench-footer">
          <p>Labels come from published lab captures. Results describe this test partition. Network-specific accuracy requires a separate labeled evaluation.</p>
          <a className="research-text-link" href="/#methodology">Methodology <ArrowRight size={15} /></a>
        </footer>
      </main>
    </div>
  );
}
