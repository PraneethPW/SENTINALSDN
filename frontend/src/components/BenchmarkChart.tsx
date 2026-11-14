import type { BenchmarkWindow } from "../benchmark";

const binCount = 25;

export default function BenchmarkChart({
  windows,
  threshold,
}: {
  windows: BenchmarkWindow[];
  threshold: number;
}) {
  const bins = Array.from({ length: binCount }, () => ({ benign: 0, attack: 0 }));
  for (const [, label, score] of windows) {
    const bin = bins[Math.min(binCount - 1, Math.floor(score * binCount))];
    bin[label ? "attack" : "benign"]++;
  }
  const largest = Math.max(1, ...bins.map((bin) => bin.benign + bin.attack));
  const ceiling = Math.ceil(largest / 100) * 100;
  const plotHeight = 156;
  const barWidth = 600 / binCount;
  const thresholdX = threshold * 600;
  return (
    <div className="bench-chart" aria-label="Model score distribution">
      <div className="bench-chart-body">
        <div className="bench-y-axis" aria-hidden="true">
          <span>{ceiling}</span><span>{ceiling / 2}</span><span>0</span>
        </div>
        <div className="bench-plot">
          <svg
            viewBox={`0 0 600 ${plotHeight + 8}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Histogram of model scores grouped by published benign and attack labels. Vertical line marks the selected threshold."
          >
            {[4, 4 + plotHeight / 2, 4 + plotHeight].map((y) => (
              <line className="bench-gridline" key={y} x1={0} y1={y} x2={600} y2={y} />
            ))}
            {bins.map((bin, index) => {
              const benign = bin.benign * plotHeight / ceiling;
              const attack = bin.attack * plotHeight / ceiling;
              const x = barWidth * index + 1;
              return (
                <g key={index}>
                  <title>{`${index * 4}–${(index + 1) * 4}% · ${bin.benign} benign, ${bin.attack} attack`}</title>
                  <rect className="bench-bin benign" x={x} width={barWidth - 2} y={plotHeight + 4 - benign} height={benign} />
                  <rect className="bench-bin attack" x={x} width={barWidth - 2} y={plotHeight + 4 - benign - attack} height={attack} />
                </g>
              );
            })}
            <line className="bench-cutoff" x1={thresholdX} x2={thresholdX} y1={0} y2={plotHeight + 6} />
          </svg>
          <div className="bench-x-axis" aria-hidden="true">
            <span>0.00</span><span>0.25</span><span>0.50</span><span>0.75</span><span>1.00</span>
          </div>
        </div>
      </div>
      <div className="bench-legend">
        <span><i className="benign" /> Labeled benign</span>
        <span><i className="attack" /> Labeled attack</span>
        <span><i className="threshold" /> Decision threshold</span>
      </div>
    </div>
  );
}
