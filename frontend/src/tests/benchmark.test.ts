import { describe, expect, it } from "vitest";
import { calculateMetrics, outcomeOf } from "../benchmark";
import type { BenchmarkWindow } from "../benchmark";

const windows: BenchmarkWindow[] = [
  [1, 1, .525, 4, 400, 100, 30, 6],
  [2, 1, .3, 4, 400, 100, 30, 6],
  [3, 0, .95, 4, 400, 100, 30, 17],
  [4, 0, .1, 4, 400, 100, 30, 17],
];

describe("benchmark threshold", () => {
  it("flags scores on the threshold and counts each outcome", () => {
    const threshold = .525;
    expect(windows.map((window) => outcomeOf(window, threshold))).toEqual(["tp", "fn", "fp", "tn"]);
    expect(calculateMetrics(windows, threshold)).toEqual({
      counts: { tp: 1, fn: 1, fp: 1, tn: 1 },
      flagged: 2, labeled: 4,
      precision: .5,
      recall: .5,
      falsePositiveRate: .5,
    });
  });

  it("scores unlabeled rows without assigning a ground-truth outcome", () => {
    const unlabeled: BenchmarkWindow = [5, null, .9, 4, 400, 100, 30, 17];
    expect(outcomeOf(unlabeled, .525)).toBeNull();
    expect(calculateMetrics([unlabeled, windows[0]], .525)).toEqual({
      counts: { tp: 1, fn: 0, fp: 0, tn: 0 },
      flagged: 2, labeled: 1, precision: 1, recall: 1, falsePositiveRate: null,
    });
  });

  it("marks precision unavailable when filtering produces zero detections", () => {
    expect(calculateMetrics(windows.filter((window) => window[7] === 6), 1)).toEqual({
      counts: { tp: 0, fn: 2, fp: 0, tn: 0 },
      flagged: 0, labeled: 2,
      precision: null,
      recall: 0,
      falsePositiveRate: null,
    });
  });
});
