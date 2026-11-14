export type Outcome = "tp" | "tn" | "fp" | "fn";

export type BenchmarkWindow = [
  id: number,
  label: 0 | 1 | null,
  score: number,
  packetsPerSecond: number,
  bytesPerSecond: number,
  meanPacketSize: number,
  durationSeconds: number,
  protocol: 1 | 6 | 17,
];

type EvaluationModel = { version: string; algorithm: string; sha256: string; threshold: number };
type Dataset = { dataset_sha256: string; rows: number; window_seconds: number };
type PublicDataset = Dataset & {
  archive_sha256: string;
  groups: number;
  split: string;
  source: { title: string; authors: string[]; doi: string; url: string; license: string };
};

export type BenchmarkReference = {
  model: EvaluationModel;
  dataset: PublicDataset;
  features: string[];
  confusion_matrix: [[number, number], [number, number]];
  roc_auc: number;
  average_precision: number;
};

export type BenchmarkRun = {
  id: string;
  completed_at: string;
  inference_ms: number;
  model: EvaluationModel;
  dataset: (PublicDataset & { kind: "public" }) | (Dataset & { kind: "upload" });
  features: string[];
  windows: BenchmarkWindow[];
};

export const outcomeInfo: Record<Outcome, { name: string; detail: string }> = {
  tp: { name: "True positive", detail: "Attack detected" },
  fn: { name: "False negative", detail: "Attack missed" },
  fp: { name: "False positive", detail: "Benign window flagged" },
  tn: { name: "True negative", detail: "Benign window accepted" },
};

export function outcomeOf(window: BenchmarkWindow, threshold: number): Outcome | null {
  if (window[1] === null) return null;
  if (window[1] === 1) return window[2] >= threshold ? "tp" : "fn";
  return window[2] >= threshold ? "fp" : "tn";
}

export function calculateMetrics(windows: BenchmarkWindow[], threshold: number) {
  const counts = { tp: 0, tn: 0, fp: 0, fn: 0 };
  let flagged = 0;
  for (const window of windows) {
    const outcome = outcomeOf(window, threshold);
    if (outcome) counts[outcome]++;
    if (window[2] >= threshold) flagged++;
  }
  return { counts, flagged, labeled: counts.tp + counts.tn + counts.fp + counts.fn, ...rates(counts) };
}

export function rates({ tp, tn, fp, fn }: Record<Outcome, number>) {
  return {
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    falsePositiveRate: fp + tn ? fp / (fp + tn) : null,
  };
}

export const number = (value: number) => value.toLocaleString();
export const percent = (value: number | null) =>
  value === null ? "—" : `${(100 * value).toFixed(2)}%`;

export function exportCohort(run: BenchmarkRun, windows: BenchmarkWindow[], threshold: number) {
  const published = run.dataset.kind === "public" ? run.dataset : null;
  const headers = [
    "run_id", "completed_at_utc", "model_version", "model_sha256", "dataset_doi",
    "partition_sha256", "dataset_sha256", "threshold", "window_id",
    published ? "published_label" : "label", "attack_score", "prediction", "outcome", ...run.features,
  ];
  const rows = windows.map((window) => {
    const [id, label, score, ...features] = window;
    return [
      run.id, run.completed_at, run.model.version, run.model.sha256,
      published?.source.doi ?? "", published?.archive_sha256 ?? "", run.dataset.dataset_sha256, threshold, id,
      label ?? "", score, Number(score >= threshold), outcomeOf(window, threshold) ?? "", ...features,
    ];
  });
  const csv = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
  ).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `sentinel-${published ? "benchmark" : "dataset"}-${run.id}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
