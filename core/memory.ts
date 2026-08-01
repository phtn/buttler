const MEBIBYTE = 1024 * 1024;

export const DEFAULT_MEMORY_WINDOW_SIZE = 60;
export const MIN_MEMORY_SAMPLES = 8;
export const MIN_MEMORY_DURATION_MS = 7_000;

export interface MemoryMeasurement {
  timestamp: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export type MemoryMetric = "heap" | "rss" | "external";
export type MemoryVerdict = "collecting" | "stable" | "growth";
export type MemoryConfidence = "none" | "low" | "medium" | "high";

export interface MemoryMetricTrend {
  current: number;
  change: number;
  retainedGrowth: number;
  slopeBytesPerMinute: number;
  growthRatio: number;
  fit: number;
  growing: boolean;
}

export interface MemoryAnalysis {
  verdict: MemoryVerdict;
  confidence: MemoryConfidence;
  suspectedMetrics: MemoryMetric[];
  sampleCount: number;
  durationMs: number;
  heapUtilization: number;
  externalRatio: number;
  observedCollections: number;
  averageReclaimed: number;
  heap: MemoryMetricTrend;
  rss: MemoryMetricTrend;
  external: MemoryMetricTrend;
}

export interface AnalyzeMemoryOptions {
  windowSize?: number;
  minimumSamples?: number;
  minimumDurationMs?: number;
}

export type MemorySampler = () => Omit<MemoryMeasurement, "timestamp">;

export interface MemoryMonitorOptions extends AnalyzeMemoryOptions {
  maxSamples?: number;
  sampler?: MemorySampler;
}

interface MetricThresholds {
  minimumRate: number;
  rateFraction: number;
  minimumRetained: number;
}

const HEAP_THRESHOLDS: MetricThresholds = {
  minimumRate: MEBIBYTE,
  rateFraction: 0.05,
  minimumRetained: MEBIBYTE,
};

const RSS_THRESHOLDS: MetricThresholds = {
  minimumRate: 2 * MEBIBYTE,
  rateFraction: 0.025,
  minimumRetained: 2 * MEBIBYTE,
};

const EXTERNAL_THRESHOLDS: MetricThresholds = {
  minimumRate: MEBIBYTE,
  rateFraction: 0.05,
  minimumRetained: MEBIBYTE,
};

function processMemorySample(): Omit<MemoryMeasurement, "timestamp"> {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function linearTrend(
  measurements: MemoryMeasurement[],
  values: number[],
): { slopeBytesPerMinute: number; fit: number } {
  if (measurements.length < 2 || values.length !== measurements.length) {
    return { slopeBytesPerMinute: 0, fit: 0 };
  }

  const origin = measurements[0]?.timestamp ?? 0;
  const x = measurements.map((measurement) =>
    (measurement.timestamp - origin) / 60_000
  );
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
  let covariance = 0;
  let varianceX = 0;
  let totalVariance = 0;

  for (let index = 0; index < values.length; index += 1) {
    const centeredX = (x[index] ?? 0) - meanX;
    const centeredY = (values[index] ?? 0) - meanY;
    covariance += centeredX * centeredY;
    varianceX += centeredX * centeredX;
    totalVariance += centeredY * centeredY;
  }

  if (varianceX === 0) return { slopeBytesPerMinute: 0, fit: 0 };
  const slopeBytesPerMinute = covariance / varianceX;
  if (totalVariance === 0) return { slopeBytesPerMinute, fit: 1 };

  let residualVariance = 0;
  for (let index = 0; index < values.length; index += 1) {
    const predicted = meanY + slopeBytesPerMinute * ((x[index] ?? 0) - meanX);
    const residual = (values[index] ?? 0) - predicted;
    residualVariance += residual * residual;
  }

  return {
    slopeBytesPerMinute,
    fit: Math.max(0, Math.min(1, 1 - residualVariance / totalVariance)),
  };
}

function metricTrend(
  measurements: MemoryMeasurement[],
  values: number[],
  thresholds: MetricThresholds,
  enoughEvidence: boolean,
): MemoryMetricTrend {
  const first = values[0] ?? 0;
  const current = values.at(-1) ?? 0;
  const third = Math.max(1, Math.floor(values.length / 3));
  const retainedGrowth = median(values.slice(-third)) - median(values.slice(0, third));
  const average = values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
  const increases = values.slice(1).reduce((count, value, index) =>
    count + (value > (values[index] ?? value) ? 1 : 0), 0
  );
  const growthRatio = values.length < 2 ? 0 : increases / (values.length - 1);
  const { slopeBytesPerMinute, fit } = linearTrend(measurements, values);
  const rateThreshold = Math.max(
    thresholds.minimumRate,
    average * thresholds.rateFraction,
  );
  const growing = enoughEvidence
    && slopeBytesPerMinute >= rateThreshold
    && retainedGrowth >= thresholds.minimumRetained
    && (fit >= 0.5 || growthRatio >= 0.75);

  return {
    current,
    change: current - first,
    retainedGrowth,
    slopeBytesPerMinute,
    growthRatio,
    fit,
    growing,
  };
}

function confidenceFor(metrics: MemoryMetric[]): MemoryConfidence {
  if (metrics.length === 0) return "none";
  if (metrics.includes("heap") && metrics.includes("rss")) return "high";
  if (metrics.includes("external") && metrics.includes("rss")) return "high";
  if (metrics.includes("heap") || metrics.includes("external")) return "medium";
  return "low";
}

export function analyzeMemoryMeasurements(
  allMeasurements: MemoryMeasurement[],
  options: AnalyzeMemoryOptions = {},
): MemoryAnalysis {
  const windowSize = Math.max(2, options.windowSize ?? DEFAULT_MEMORY_WINDOW_SIZE);
  const minimumSamples = Math.max(2, options.minimumSamples ?? MIN_MEMORY_SAMPLES);
  const minimumDurationMs = Math.max(0, options.minimumDurationMs ?? MIN_MEMORY_DURATION_MS);
  const measurements = allMeasurements
    .filter((measurement, index) =>
      Number.isFinite(measurement.timestamp)
      && (index === 0 || measurement.timestamp > (allMeasurements[index - 1]?.timestamp ?? -Infinity))
    )
    .slice(-windowSize);
  const first = measurements[0];
  const latest = measurements.at(-1);
  const durationMs = first && latest ? Math.max(0, latest.timestamp - first.timestamp) : 0;
  const enoughEvidence = measurements.length >= minimumSamples
    && durationMs >= minimumDurationMs;
  const heap = metricTrend(
    measurements,
    measurements.map((measurement) => measurement.heapUsed),
    HEAP_THRESHOLDS,
    enoughEvidence,
  );
  const rss = metricTrend(
    measurements,
    measurements.map((measurement) => measurement.rss),
    RSS_THRESHOLDS,
    enoughEvidence,
  );
  const external = metricTrend(
    measurements,
    measurements.map((measurement) => measurement.external),
    EXTERNAL_THRESHOLDS,
    enoughEvidence,
  );
  const suspectedMetrics: MemoryMetric[] = [];
  if (heap.growing) suspectedMetrics.push("heap");
  if (rss.growing) suspectedMetrics.push("rss");
  if (external.growing) suspectedMetrics.push("external");

  let observedCollections = 0;
  let reclaimed = 0;
  for (let index = 1; index < measurements.length; index += 1) {
    const drop = (measurements[index - 1]?.heapUsed ?? 0)
      - (measurements[index]?.heapUsed ?? 0);
    if (drop >= MEBIBYTE) {
      observedCollections += 1;
      reclaimed += drop;
    }
  }

  const heapTotal = latest?.heapTotal ?? 0;
  const heapUsed = latest?.heapUsed ?? 0;
  const externalUsed = latest?.external ?? 0;

  return {
    verdict: enoughEvidence
      ? suspectedMetrics.length > 0 ? "growth" : "stable"
      : "collecting",
    confidence: confidenceFor(suspectedMetrics),
    suspectedMetrics,
    sampleCount: measurements.length,
    durationMs,
    heapUtilization: heapTotal > 0 ? heapUsed / heapTotal : 0,
    externalRatio: heapUsed > 0 ? externalUsed / heapUsed : 0,
    observedCollections,
    averageReclaimed: observedCollections > 0 ? reclaimed / observedCollections : 0,
    heap,
    rss,
    external,
  };
}

export class MemoryMonitor {
  readonly measurements: MemoryMeasurement[] = [];
  private readonly maxSamples: number;
  private readonly sampler: MemorySampler;
  private readonly analysisOptions: AnalyzeMemoryOptions;

  constructor(options: MemoryMonitorOptions = {}) {
    this.maxSamples = Math.max(2, options.maxSamples ?? 300);
    this.sampler = options.sampler ?? processMemorySample;
    this.analysisOptions = {
      windowSize: options.windowSize,
      minimumSamples: options.minimumSamples,
      minimumDurationMs: options.minimumDurationMs,
    };
  }

  sample(timestamp = Date.now()): MemoryMeasurement {
    const measurement = { timestamp, ...this.sampler() };
    const previous = this.measurements.at(-1);
    if (previous && timestamp <= previous.timestamp) {
      throw new Error("Memory measurement timestamps must increase.");
    }
    this.measurements.push(measurement);
    if (this.measurements.length > this.maxSamples) this.measurements.shift();
    return measurement;
  }

  analyze(): MemoryAnalysis {
    return analyzeMemoryMeasurements(this.measurements, this.analysisOptions);
  }

  reset(): void {
    this.measurements.length = 0;
  }
}

export function forceGarbageCollection(): void {
  Bun.gc(true);
}
