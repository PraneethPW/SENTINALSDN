import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { request } from "../api";
import { number, percent, rates } from "../benchmark";
import type { BenchmarkReference as Reference } from "../benchmark";

let referenceRequest: Promise<Reference> | undefined;
function loadReference() {
  referenceRequest ??= request<Reference>("/api/benchmark/reference").then(result => {
    if (!result.dataset || !result.model || !Array.isArray(result.confusion_matrix))
      throw new Error("Benchmark reference unavailable");
    return result;
  }).catch((error: unknown) => {
    referenceRequest = undefined;
    throw error;
  });
  return referenceRequest;
}

export default function BenchmarkReference({
  layout = "full",
  action,
}: {
  layout?: "full" | "compact";
  action?: React.ReactNode;
}) {
  const [reference, setReference] = useState<Reference | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    void loadReference().then((result) => {
      if (!active) return;
      setReference(result);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  const ready = reference !== null;
  const [[tn, fp], [fn, tp]] = reference?.confusion_matrix ?? [[0, 0], [0, 0]];
  const { precision, recall, falsePositiveRate } = rates({ tn, fp, fn, tp });
  return (
    <section className={`reference-panel reference-${layout}`} aria-label="Published benchmark">
      <div className="reference-heading">
        <div>
          <h2>Published benchmark</h2>
          {ready ? <p>{number(reference.dataset.rows)} test windows · {reference.dataset.groups} held-out groups</p> : null}
        </div>
        {action}
      </div>
      {ready ? (
        <>
          <dl className="reference-metrics">
            <div><dt>Attack precision</dt><dd>{percent(precision)}</dd></div>
            <div><dt>Attack recall</dt><dd>{percent(recall)}</dd></div>
            <div><dt>False-positive rate</dt><dd>{percent(falsePositiveRate)}</dd></div>
          </dl>
          {layout === "full" ? (
            <table className="reference-matrix">
              <caption>Decisions at the {percent(reference.model.threshold)} threshold</caption>
              <thead><tr><th scope="col">Actual label</th><th scope="col">Flagged</th><th scope="col">Passed</th></tr></thead>
              <tbody>
                <tr><th scope="row">Attack</th><td>{number(tp)}</td><td><a href="/auth/sign-in?outcome=fn#benchmark">{number(fn)} missed <ArrowUpRight size={13} /></a></td></tr>
                <tr><th scope="row">Benign</th><td><a href="/auth/sign-in?outcome=fp#benchmark">{number(fp)} false alarms <ArrowUpRight size={13} /></a></td><td>{number(tn)}</td></tr>
              </tbody>
            </table>
          ) : null}
          <div className="reference-foot">
            <p>{reference.model.algorithm} · {layout === "compact" ? `${percent(reference.model.threshold)} threshold` : "Published Mininet flows"}</p>
            <a className="research-text-link" href={reference.dataset.source.url}>Dataset source <ArrowUpRight size={14} /></a>
          </div>
        </>
      ) : (
        <p className="reference-limits" role="status">
          {failed ? <>Benchmark figures are unavailable. <button className="research-text-link" onClick={() => setAttempt(value => value + 1)}>Try again</button></> : "Loading saved benchmark figures…"}
        </p>
      )}
    </section>
  );
}
