import { describe, expect, test } from "bun:test";
import {
  analyzeMemoryMeasurements,
  MemoryMonitor,
  type MemoryMeasurement,
} from "../core";

const MEBIBYTE = 1024 * 1024;

function measurement(
  index: number,
  values: Partial<Omit<MemoryMeasurement, "timestamp">> = {},
): MemoryMeasurement {
  return {
    timestamp: index * 1_000,
    rss: 80 * MEBIBYTE,
    heapTotal: 40 * MEBIBYTE,
    heapUsed: 20 * MEBIBYTE,
    external: 2 * MEBIBYTE,
    arrayBuffers: MEBIBYTE,
    ...values,
  };
}

describe("memory analysis", () => {
  test("waits for enough elapsed samples before making a claim", () => {
    const analysis = analyzeMemoryMeasurements([
      measurement(0),
      measurement(1, { heapUsed: 24 * MEBIBYTE }),
      measurement(2, { heapUsed: 28 * MEBIBYTE }),
    ]);

    expect(analysis.verdict).toBe("collecting");
    expect(analysis.suspectedMetrics).toEqual([]);
  });

  test("detects sustained heap and RSS growth", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      measurement(index, {
        heapUsed: (20 + index * 1.5) * MEBIBYTE,
        rss: (80 + index * 2) * MEBIBYTE,
      })
    );
    const analysis = analyzeMemoryMeasurements(samples);

    expect(analysis.verdict).toBe("growth");
    expect(analysis.confidence).toBe("high");
    expect(analysis.suspectedMetrics).toContain("heap");
    expect(analysis.suspectedMetrics).toContain("rss");
    expect(analysis.heap.slopeBytesPerMinute).toBeGreaterThan(80 * MEBIBYTE);
  });

  test("does not mistake a GC sawtooth for sustained growth", () => {
    const heap = [20, 22, 24, 18, 20, 22, 17, 19, 21, 18, 20, 19];
    const samples = heap.map((heapUsed, index) =>
      measurement(index, {
        heapUsed: heapUsed * MEBIBYTE,
        rss: (80 + (index % 2) * 0.25) * MEBIBYTE,
      })
    );
    const analysis = analyzeMemoryMeasurements(samples);

    expect(analysis.verdict).toBe("stable");
    expect(analysis.heap.growing).toBe(false);
    expect(analysis.observedCollections).toBeGreaterThan(0);
  });

  test("reports RSS-only growth with low confidence", () => {
    const samples = Array.from({ length: 12 }, (_, index) =>
      measurement(index, { rss: (80 + index * 3) * MEBIBYTE })
    );
    const analysis = analyzeMemoryMeasurements(samples);

    expect(analysis.verdict).toBe("growth");
    expect(analysis.confidence).toBe("low");
    expect(analysis.suspectedMetrics).toEqual(["rss"]);
  });
});

test("MemoryMonitor caps history, analyzes it, and resets", () => {
  let heapUsed = 10 * MEBIBYTE;
  const monitor = new MemoryMonitor({
    maxSamples: 3,
    minimumSamples: 2,
    minimumDurationMs: 0,
    sampler: () => ({
      rss: 50 * MEBIBYTE,
      heapTotal: 20 * MEBIBYTE,
      heapUsed: heapUsed += MEBIBYTE,
      external: MEBIBYTE,
      arrayBuffers: 0,
    }),
  });

  monitor.sample(1_000);
  monitor.sample(2_000);
  monitor.sample(3_000);
  monitor.sample(4_000);

  expect(monitor.measurements).toHaveLength(3);
  expect(monitor.measurements[0]?.timestamp).toBe(2_000);
  expect(monitor.analyze().sampleCount).toBe(3);
  expect(() => monitor.sample(4_000)).toThrow("timestamps must increase");

  monitor.reset();
  expect(monitor.measurements).toEqual([]);
  expect(monitor.analyze().verdict).toBe("collecting");
});
