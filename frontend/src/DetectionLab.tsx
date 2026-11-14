import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight,
  CircleAlert, LoaderCircle, Play, RotateCcw, Upload,
} from "lucide-react";
import { protocolName, request } from "./api";
import { calculateMetrics, exportCohort, number, outcomeInfo, outcomeOf, percent } from "./benchmark";
import type { BenchmarkRun, BenchmarkWindow, Outcome } from "./benchmark";
import BenchmarkChart from "./components/BenchmarkChart";
import BenchmarkReference from "./components/BenchmarkReference";

const perPage = 12;
const outcomes: Outcome[] = ["tp", "fn", "fp", "tn"];
const maxCsvSize = 1_000_000;

function WindowInspector({ row, threshold }: { row: BenchmarkWindow; threshold: number }) {
  const [id, label, score, packetRate, byteRate, meanSize, duration, protocol] = row;
  const outcome = outcomeOf(row, threshold);
  return (
    <tr className="bench-inspector">
      <td colSpan={6}>
        <strong>Window {id} · {outcome ? outcomeInfo[outcome].detail : "Unlabeled window"}</strong>
        <p>
          The model score {percent(score)} {score >= threshold ? "meets or exceeds" : "is below"} the {percent(threshold)} decision threshold.
          {label === null ? "This window has no supplied label." : `The reference label is ${label ? "attack" : "benign"}.`}
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

function Results({ run, initialOutcome }: { run: BenchmarkRun; initialOutcome: "all" | Outcome }) {
  const published = run.dataset.kind === "public" ? run.dataset : null;
  const protocolId = useId(), thresholdId = useId(), windowsId = useId();
  const [threshold, setThreshold] = useState(run.model.threshold);
  const [protocol, setProtocol] = useState("all");
  const [outcome, setOutcome] = useState<"all" | Outcome>(initialOutcome);
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
  const labeled = run.windows.some((row) => row[1] !== null);
  const metricsCards = labeled ? [
    ["Windows in view", number(cohort.length), `${number(metrics.labeled)} labeled windows`],
    ["Attack precision", percent(metrics.precision), "Correct flags / labeled flags"],
    ["Attack recall", percent(metrics.recall), "Detected attacks / labeled attacks"],
    ["False-positive rate", percent(metrics.falsePositiveRate), "False alarms / labeled benign"],
  ] : [
    ["Windows in view", number(cohort.length), "Scored flow windows"],
    ["Flagged windows", number(metrics.flagged), "At or above the threshold"],
    ["Below threshold", number(cohort.length - metrics.flagged), "Model predicts benign"],
    ["Flagged share", percent(cohort.length ? metrics.flagged / cohort.length : null), "Flags / all windows"],
  ];

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
        <div className="bench-protocol"><label htmlFor={protocolId}>Protocol</label>
          <select id={protocolId} value={protocol} onChange={(event) => {
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
        {metricsCards.map(([name, value, detail]) => (
          <article className="bench-panel bench-metric" key={name}>
            <h2>{name}</h2><strong>{value}</strong><p>{detail}</p>
          </article>
        ))}
      </div>
      <div className="bench-analysis">
        <section className="bench-panel">
          <div className="bench-panel-heading">
            <h2>Score distribution</h2>
            <p>Counts by model score and available labels. Scores are uncalibrated.</p>
          </div>
          {cohort.length > 0 ? <BenchmarkChart windows={cohort} threshold={threshold} /> :
            <p className="bench-empty">This dataset has no windows for the selected protocol.</p>}
          <div className="bench-threshold">
            <div>
              <label htmlFor={thresholdId}>Decision threshold <strong>{percent(threshold)}</strong></label>
              <button className="research-text-link" type="button" onClick={() => changeThreshold(run.model.threshold)}
                disabled={threshold === run.model.threshold}>
                <RotateCcw size={14} /> Reset
              </button>
            </div>
            <input
              id={thresholdId} type="range" min="0" max="1" step="0.001"
              value={threshold} onChange={(event) => changeThreshold(Number(event.target.value))}
              aria-valuetext={percent(threshold)}
            />
            <p>Scores at or above the threshold are flagged. This slider only changes the benchmark verdicts.</p>
          </div>
        </section>
        {labeled ? <section className="bench-panel">
          <div className="bench-panel-heading">
            <h2>Confusion matrix</h2>
            <p>{metrics.labeled < cohort.length ? `Counts use the ${number(metrics.labeled)} labeled windows. Select a cell to inspect them.` : "Select a cell to inspect matching flow windows."}</p>
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
        </section> : <section className="bench-panel">
          <div className="bench-panel-heading">
            <h2>Evaluate against known labels</h2>
            <p>Add a <code>label</code> column with 0 for benign and 1 for attack to calculate precision, recall and the confusion matrix. This run shows scores and verdicts for every row.</p>
          </div>
        </section>}
      </div>
      <section className="bench-panel bench-windows" aria-labelledby={windowsId}>
        <div className="bench-panel-heading bench-window-heading">
          <div>
            <h2 id={windowsId}>Window evidence</h2>
            <p>Sorted by distance to the selected threshold. Select a window to inspect its five model inputs.</p>
          </div>
          <div className="bench-table-actions">
            {labeled ? <select aria-label="Filter evidence by outcome" value={outcome}
              onChange={(event) => changeOutcome(event.target.value as "all" | Outcome)}>
              <option value="all">All outcomes</option>
              {outcomes.map((key) => <option key={key} value={key}>{outcomeInfo[key].name}</option>)}
            </select> : null}
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
                <tr><th>Window</th><th>Protocol</th><th>{published ? "Published label" : "Supplied label"}</th><th>ML verdict</th><th>Attack score</th><th>Outcome</th></tr>
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
                      <td>{label === null ? "—" : label ? "Attack" : "Benign"}</td>
                      <td>{score >= threshold ? "Flagged" : "Benign"}</td>
                      <td className="mono">{percent(score)}</td>
                      <td><span className={`bench-outcome ${result ?? ""}`}>{result ? outcomeInfo[result].name : score >= threshold ? "Flagged" : "Below threshold"}</span></td>
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
          {published ? <div><dt>Test partition checksum</dt><dd><code>{published.archive_sha256}</code></dd></div> : null}
          <div><dt>{published ? "Prepared dataset checksum" : "Uploaded CSV checksum"}</dt><dd><code>{run.dataset.dataset_sha256}</code></dd></div>
          <div><dt>Reference threshold</dt><dd>{percent(run.model.threshold)}</dd></div>
          {published ? <div><dt>Test split</dt><dd>{published.groups} held-out groups. {published.split}.</dd></div> : null}
          <div><dt>Run ID</dt><dd><code>{run.id}</code></dd></div>
          <div><dt>Completed at</dt><dd>{new Date(run.completed_at).toISOString()}</dd></div>
          {published ? <div><dt>Source</dt><dd>{published.source.authors.join(", ")}. <a href={published.source.url}>{published.source.title}</a> ({published.source.license}).</dd></div> : null}
        </dl>
      </details>
    </>
  );
}

export default function DetectionLab({ placement }: { placement: "sign-in" | "workspace" }) {
  const [run, setRun] = useState<BenchmarkRun | null>(null);
  const [busy, setBusy] = useState<"public" | "upload" | null>(null);
  const [error, setError] = useState<{ source: "public" | "upload"; message: string } | null>(null);
  const [status, setStatus] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const activeControl = useRef<HTMLButtonElement | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const uploadId = useId();
  const resultsId = useId();

  useEffect(() => {
    if (placement !== "sign-in" || location.hash !== "#upload-dataset") return;
    const frame = requestAnimationFrame(() => document.getElementById("upload-dataset")?.scrollIntoView());
    return () => cancelAnimationFrame(frame);
  }, [placement]);

  useEffect(() => {
    if (run && document.activeElement === activeControl.current)
      resultsHeading.current?.focus();
    activeControl.current = null;
  }, [run]);

  async function start(control: HTMLButtonElement, upload?: File) {
    if (busy) return;
    const source = upload ? "upload" : "public";
    if (upload && upload.size > maxCsvSize) {
      setError({ source, message: "Upload a CSV of up to 1 MB." });
      return;
    }
    setBusy(source);
    setError(null);
    setStatus(upload ? "Scoring your uploaded windows." : "Scoring the published benchmark windows.");
    try {
      const result = await request<BenchmarkRun>(upload ? "/api/benchmark/upload" : "/api/benchmark/run", null, {
        method: "POST",
        ...(upload ? { body: upload, headers: { "Content-Type": "text/csv" } } : {}),
      });
      if (!Array.isArray(result.windows) || result.windows.length !== result.dataset?.rows || !result.model)
        throw new Error("The API did not return a complete evaluation. Please try again.");
      activeControl.current = control;
      setRun(result);
      setStatus(`Run complete. ${number(result.dataset.rows)} ${upload ? "uploaded" : "labeled"} windows scored.`);
    } catch (e) {
      setError({ source, message: e instanceof Error ? e.message : "Evaluation could not run. Try again." });
      setStatus("");
    } finally {
      setBusy(null);
    }
  }

  const published = run?.dataset.kind === "public" ? run.dataset : null;
  const requestedOutcome = placement === "sign-in" ? new URLSearchParams(location.search).get("outcome") : null;
  const initialOutcome = requestedOutcome === "fn" || requestedOutcome === "fp" ? requestedOutcome : "all";
  return (
    <div className={`benchmark-embed benchmark-${placement}`}>
      <section className="lab-intro" id="benchmark" aria-labelledby={headingId} tabIndex={-1}>
        <div className="lab-intro-main">
          <h2 id={headingId}>Detection Lab</h2>
          <p>Run the installed model on the held-out Mininet test set or score a CSV of your own SDN flow windows.</p>
          {initialOutcome !== "all" && !run ? <p className="lab-selected-outcome">Run the benchmark to inspect {outcomeInfo[initialOutcome].name.toLowerCase()} windows.</p> : null}
          <div className="lab-actions-row">
            <button className="research-button primary" type="button"
              onClick={(event) => void start(event.currentTarget)} aria-disabled={!!busy} aria-busy={busy === "public"}>
              {busy === "public" ? <LoaderCircle size={18} className="spin" /> : <Play size={18} />}
              {busy === "public" ? "Scoring windows…" : published ? "Rerun benchmark" : "Run benchmark"}
            </button>
            <button className="research-button ghost" type="button" onClick={() => document.getElementById(uploadId)?.focus()}>
              <Upload size={16} /> Try your dataset
            </button>
          </div>
          {error?.source === "public" ? <p className="bench-error" role="alert"><CircleAlert size={18} />{error.message}</p> : null}
          <BenchmarkReference layout="compact" />
        </div>
      </section>
      <section className="bench-panel dataset-upload" id="upload-dataset" aria-labelledby={uploadId}>
          <h2 id={uploadId} tabIndex={-1}>Evaluate your own CSV</h2>
          <p>Up to 5,000 flow windows and 1 MB. Include a label column for precision, recall, and error counts. All rows receive a model score.</p>
          <form onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent).submitter;
            if (file && submitter instanceof HTMLButtonElement) void start(submitter, file);
          }}>
            <label htmlFor={`${uploadId}-file`}>Dataset CSV</label>
            <input id={`${uploadId}-file`} type="file" accept=".csv,text/csv" disabled={!!busy}
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null); }} />
            <div className="dataset-actions">
              <button className="research-button primary" type="submit" disabled={!file} aria-disabled={!!busy || !file} aria-busy={busy === "upload"}>
                {busy === "upload" ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
                {busy === "upload" ? "Scoring your CSV…" : "Score dataset"}
              </button>
              <a className="research-text-link" href="/assets/sentinel-dataset-template.csv" download>
                Download CSV template <ArrowDownToLine size={15} />
              </a>
            </div>
          </form>
          <details>
            <summary>Required columns and units</summary>
            <p><code>packet_rate</code> (pkt/s), <code>byte_rate</code> (B/s), <code>mean_packet_size</code> (B), <code>duration_seconds</code> (s), and <code>protocol</code> (ICMP, TCP, UDP or 1, 6, 17). Use 30-second windows. Optional <code>label</code> values are 0/benign, 1/attack, or blank. Optional <code>interval_seconds</code> checks sampling cadence.</p>
          </details>
          <p className="dataset-privacy">Files are processed by the detector in memory. Include only flow features and labels.</p>
          {error?.source === "upload" ? <p className="bench-error" role="alert"><CircleAlert size={18} />{error.message}</p> : null}
      </section>
      <p className="research-sr-only" role="status">{status}</p>
      {run ? (
        <section className="benchmark-results" aria-labelledby={resultsId}>
          <div className="research-section-title benchmark-results-title">
            <h2 id={resultsId} ref={resultsHeading} tabIndex={-1}>{published ? "Benchmark results" : "Your dataset results"}</h2>
            {published ? <a className="research-text-link" href={published.source.url}>Published Mininet dataset <ArrowUpRight size={15} /></a> : null}
          </div>
          <Results key={run.id} run={run} initialOutcome={published ? initialOutcome : "all"} />
          <footer className="bench-footer">
            <p>{published ? "Results describe this published test partition. Network-specific accuracy requires separate labeled windows." : "Metrics use labels supplied in your CSV. Unlabeled windows receive scores and verdicts."}</p>
            <a className="research-text-link" href="/#methodology">Methodology <ArrowRight size={15} /></a>
          </footer>
        </section>
      ) : null}
    </div>
  );
}
