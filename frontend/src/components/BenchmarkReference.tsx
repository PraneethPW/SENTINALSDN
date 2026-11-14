import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { request } from "../api";
import { number, percent, rates } from "../benchmark";
import type { BenchmarkReference as Reference } from "../benchmark";

let referenceRequest: Promise<Reference> | undefined;
function loadReference() {
  referenceRequest ??= request<Reference>("/api/benchmark/reference").catch((error: unknown) => {
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
  useEffect(() => {
    let active = true;
    void loadReference().then((result) => {
      if (!active) return;
      if (!result.dataset || !result.model || !Array.isArray(result.confusion_matrix)) {
        throw new Error("Benchmark reference unavailable");
      }
      setReference(result);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  const ready = reference !== null;
  const [[tn, fp], [fn, tp]] = reference?.confusion_matrix ?? [[0, 0], [0, 0]];
  const { precision, recall, falsePositiveRate } = rates({ tn, fp, fn, tp });
  return (
    <section className={`reference-panel reference-${layout}`} aria-label="Published benchmark">
      <div className="reference-heading">
        <div>
          <p className="research-eyebrow">PUBLISHED BENCHMARK</p>
          <h2>{layout === "full" ? "How the detector scored." : "Reference results"}</h2>
        </div>
        {action}
      </div>
      {ready ? (
        <>
          <ul className="reference-metrics">
            <li><strong>{number(reference.dataset.rows)}</strong><span>Test windows</span></li>
            <li><strong>{percent(precision)}</strong><span>Attack precision</span></li>
            <li><strong>{percent(recall)}</strong><span>Attack recall</span></li>
            <li><strong>{percent(falsePositiveRate)}</strong><span>False-positive rate</span></li>
          </ul>
          {layout === "full" ? (
            <div className="reference-details">
              <div>
                <h3>Attack-labeled windows</h3>
                <p><strong>{number(tp)} detected</strong><span>{number(fn)} missed</span></p>
                <div className="reference-bar" aria-hidden="true"><i style={{ width: percent(recall) }} /></div>
              </div>
              <div>
                <h3>Benign-labeled windows</h3>
                <p><strong>{number(tn)} accepted</strong><span>{number(fp)} flagged</span></p>
                <div className="reference-bar" aria-hidden="true"><i style={{ width: percent(tn / (tn + fp)) }} /></div>
              </div>
            </div>
          ) : null}
          <div className="reference-foot">
            <p>{reference.model.algorithm} · {reference.dataset.groups} held-out groups · {percent(reference.model.threshold)} reference threshold</p>
            <a className="research-text-link" href={reference.dataset.source.url}>Dataset source <ArrowUpRight size={14} /></a>
          </div>
          {layout === "full" ? <p className="reference-limits">These results describe published Mininet captures. Evaluate labeled windows from your own network to measure performance there.</p> : null}
        </>
      ) : (
        <p className="reference-limits" role="status">
          {failed ? "Reference results are temporarily unavailable." : "Loading the verified model’s reference results…"}
        </p>
      )}
    </section>
  );
}
