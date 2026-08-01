import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core";
import {
  forceGarbageCollection,
  MemoryMonitor,
  MIN_MEMORY_DURATION_MS,
  MIN_MEMORY_SAMPLES,
  type MemoryAnalysis,
  type MemoryMeasurement,
  type MemoryMetricTrend,
} from "../core";
import { theme, type ThemeColor } from "./theme";

const WIDE_LAYOUT_MIN_WIDTH = 88;
const SPARKLINE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

type StatusTone = "normal" | "success" | "warning" | "error";

export interface MemoryDashboardOptions {
  intervalMs?: number;
  autoStart?: boolean;
  monitor?: MemoryMonitor;
  onQuit?: () => void;
  onBack?: () => void;
}

export interface MemoryDashboard {
  readonly root: BoxRenderable;
  readonly monitor: MemoryMonitor;
  readonly paused: boolean;
  sample(timestamp?: number): MemoryMeasurement;
  setStatus(message: string, tone?: StatusTone): void;
  dispose(): void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const precision = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(precision)} ${units[unit]}`;
}

function formatRate(bytesPerMinute: number): string {
  if (Math.abs(bytesPerMinute) < 1) return "0 B/min";
  return `${formatBytes(bytesPerMinute)}/min`;
}

function statusColor(tone: StatusTone): ThemeColor {
  switch (tone) {
    case "success":
      return theme.success;
    case "warning":
      return theme.warning;
    case "error":
      return theme.error;
    default:
      return theme.textMuted;
  }
}

function verdictColor(analysis: MemoryAnalysis): ThemeColor {
  if (analysis.verdict === "growth") {
    return analysis.confidence === "low" ? theme.warning : theme.error;
  }
  return analysis.verdict === "stable" ? theme.success : theme.info;
}

function verdictLabel(analysis: MemoryAnalysis): string {
  if (analysis.verdict === "growth") return "GROWTH SIGNAL";
  if (analysis.verdict === "stable") return "STABLE";
  return "COLLECTING BASELINE";
}

function pushLine(
  chunks: TextChunk[],
  value = "",
  color: ThemeColor = theme.text,
): void {
  chunks.push(fg(color)(`${value}\n`));
}

function sparkline(values: number[], width: number): string {
  if (values.length === 0 || width <= 0) return "";
  const display = values.length <= width
    ? values
    : Array.from({ length: width }, (_, index) => {
        const sourceIndex = width === 1
          ? values.length - 1
          : Math.round(index * (values.length - 1) / (width - 1));
        return values[sourceIndex] ?? 0;
      });
  const minimum = Math.min(...display);
  const maximum = Math.max(...display);
  const range = maximum - minimum;
  return display.map((value) => {
    const normalized = range === 0 ? 0 : (value - minimum) / range;
    return SPARKLINE[Math.round(normalized * (SPARKLINE.length - 1))] ?? SPARKLINE[0];
  }).join("");
}

function metricLine(
  label: string,
  trend: MemoryMetricTrend,
  color: ThemeColor,
): TextChunk[] {
  const signal = trend.growing ? "  growth" : "";
  return [
    bold(fg(color)(label.padEnd(9))),
    fg(theme.text)(trend.current === 0 ? "—".padStart(10) : formatBytes(trend.current).padStart(10)),
    fg(theme.textMuted)("   "),
    fg(trend.slopeBytesPerMinute > 0 ? theme.warning : theme.textMuted)(
      formatRate(trend.slopeBytesPerMinute).padStart(13),
    ),
    trend.growing ? bold(fg(color)(signal)) : fg(theme.textMuted)(signal),
    fg(theme.text)("\n"),
  ];
}

function trendsText(
  measurements: MemoryMeasurement[],
  analysis: MemoryAnalysis,
  chartWidth: number,
): StyledText {
  const recent = measurements.slice(-Math.max(1, chartWidth));
  const chunks: TextChunk[] = [];
  chunks.push(bold(fg(theme.text)("CURRENT")));
  pushLine(chunks, "                 value           trend", theme.textMuted);
  chunks.push(...metricLine("Heap", analysis.heap, analysis.heap.growing ? theme.error : theme.accent));
  chunks.push(...metricLine("RSS", analysis.rss, analysis.rss.growing ? theme.error : theme.info));
  chunks.push(...metricLine("External", analysis.external, analysis.external.growing ? theme.error : theme.warning));
  pushLine(chunks);
  chunks.push(bold(fg(theme.text)("LAST SAMPLES")));
  pushLine(chunks);
  pushLine(
    chunks,
    `Heap  ${sparkline(recent.map((item) => item.heapUsed), chartWidth)}`,
    theme.accent,
  );
  pushLine(
    chunks,
    `RSS   ${sparkline(recent.map((item) => item.rss), chartWidth)}`,
    theme.info,
  );
  pushLine(
    chunks,
    `Ext   ${sparkline(recent.map((item) => item.external), chartWidth)}`,
    theme.warning,
  );
  pushLine(chunks);

  const first = recent[0];
  const last = recent.at(-1);
  const duration = first && last ? (last.timestamp - first.timestamp) / 1_000 : 0;
  pushLine(
    chunks,
    `${recent.length} visible samples · ${duration.toFixed(1)}s · rolling analysis window`,
    theme.textMuted,
  );
  return new StyledText(chunks);
}

function insightText(analysis: MemoryAnalysis): StyledText {
  const chunks: TextChunk[] = [];
  const color = verdictColor(analysis);
  chunks.push(bold(fg(color)(verdictLabel(analysis))));
  pushLine(chunks);

  if (analysis.verdict === "collecting") {
    const secondsLeft = Math.max(
      0,
      Math.ceil((MIN_MEMORY_DURATION_MS - analysis.durationMs) / 1_000),
    );
    pushLine(
      chunks,
      `${analysis.sampleCount}/${MIN_MEMORY_SAMPLES} minimum samples · at least ${secondsLeft}s remaining`,
      theme.textMuted,
    );
  } else if (analysis.verdict === "growth") {
    pushLine(
      chunks,
      `Confidence: ${analysis.confidence.toUpperCase()}`,
      color,
    );
    pushLine(
      chunks,
      `Signals: ${analysis.suspectedMetrics.map((metric) => metric.toUpperCase()).join(", ")}`,
      theme.text,
    );
    pushLine(chunks);
    pushLine(
      chunks,
      "Sustained growth is evidence to investigate, not proof of a leak.",
      theme.warning,
    );
  } else {
    pushLine(chunks, "No sustained growth passes the current thresholds.", theme.success);
  }

  pushLine(chunks);
  chunks.push(bold(fg(theme.text)("RUNTIME CONTEXT")));
  pushLine(chunks);
  const utilization = Math.round(analysis.heapUtilization * 100);
  const pressureColor = utilization >= 80
    ? theme.error
    : utilization >= 60 ? theme.warning : theme.success;
  pushLine(chunks, `Heap utilization  ${utilization}%`, pressureColor);
  pushLine(
    chunks,
    `External / heap   ${Math.round(analysis.externalRatio * 100)}%`,
    theme.textMuted,
  );
  pushLine(
    chunks,
    `Observed drops    ${analysis.observedCollections}`,
    theme.textMuted,
  );
  if (analysis.observedCollections > 0) {
    pushLine(
      chunks,
      `Avg reclaimed     ${formatBytes(analysis.averageReclaimed)}`,
      theme.textMuted,
    );
  }

  pushLine(chunks);
  chunks.push(bold(fg(theme.text)("SCOPE")));
  pushLine(chunks);
  pushLine(
    chunks,
    "This dashboard watches the current Buttler process. Use an inspector or heap snapshot to confirm and locate a leak.",
    theme.textMuted,
  );
  return new StyledText(chunks);
}

function summaryText(
  analysis: MemoryAnalysis,
  paused: boolean,
  intervalMs: number,
): StyledText {
  return new StyledText([
    bold(fg(verdictColor(analysis))(verdictLabel(analysis))),
    fg(theme.border)("  ·  "),
    fg(theme.text)(`${analysis.sampleCount} samples`),
    fg(theme.border)("  ·  "),
    fg(theme.textMuted)(`${(analysis.durationMs / 1_000).toFixed(1)}s window`),
    fg(theme.border)("  ·  "),
    fg(paused ? theme.warning : theme.success)(paused ? "paused" : `live ${intervalMs}ms`),
  ]);
}

export function createMemoryDashboard(
  renderer: CliRenderer,
  options: MemoryDashboardOptions = {},
): MemoryDashboard {
  const intervalMs = Math.max(100, options.intervalMs ?? 1_000);
  const monitor = options.monitor ?? new MemoryMonitor();
  let paused = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const root = new BoxRenderable(renderer, {
    id: "memory-app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  });
  const header = new BoxRenderable(renderer, {
    id: "memory-header",
    width: "100%",
    height: 2,
    paddingX: 1,
    flexDirection: "column",
    backgroundColor: theme.surfaceRaised,
  });
  const brand = new TextRenderable(renderer, {
    id: "memory-brand",
    width: "100%",
    height: 1,
    content: new StyledText([
      fg(theme.accent)("🅿 "),
      fg(theme.border)("⧸  ▸  "),
      bold(fg(theme.text)("∿ Memory")),
      fg(theme.border)("  ▸  "),
      fg(theme.textMuted)("current Buttler process"),
    ]),
  });
  const summary = new TextRenderable(renderer, {
    id: "memory-summary",
    width: "100%",
    height: 1,
    content: "",
  });
  header.add(brand);
  header.add(summary);

  const main = new BoxRenderable(renderer, {
    id: "memory-main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
    backgroundColor: theme.background,
  });
  const trendsPanel = new BoxRenderable(renderer, {
    id: "memory-trends-panel",
    width: "62%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: " MEMORY TRENDS ",
    titleColor: theme.textMuted,
    paddingX: 1,
    backgroundColor: theme.surface,
  });
  const trends = new TextRenderable(renderer, {
    id: "memory-trends",
    width: "100%",
    height: "auto",
    content: "",
  });
  trendsPanel.add(trends);

  const insightPanel = new BoxRenderable(renderer, {
    id: "memory-insight-panel",
    width: "38%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: " ANALYSIS ",
    titleColor: theme.textMuted,
    paddingX: 1,
    backgroundColor: theme.surface,
  });
  const insight = new TextRenderable(renderer, {
    id: "memory-insight",
    width: "100%",
    height: "auto",
    wrapMode: "word",
    content: "",
  });
  insightPanel.add(insight);
  main.add(trendsPanel);
  main.add(insightPanel);

  const footer = new BoxRenderable(renderer, {
    id: "memory-footer",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const shortcutChunks: TextChunk[] = [
    fg(theme.text)(" space "),
    fg(theme.textMuted)("pause   "),
    fg(theme.text)(" r "),
    fg(theme.textMuted)("reset   "),
    fg(theme.text)(" g "),
    fg(theme.textMuted)("GC + sample   "),
  ];
  if (options.onBack) {
    shortcutChunks.push(fg(theme.text)(" Esc/b "), fg(theme.textMuted)("back   "));
  }
  shortcutChunks.push(fg(theme.text)(" q "), fg(theme.textMuted)("quit"));
  const shortcuts = new TextRenderable(renderer, {
    id: "memory-shortcuts",
    flexGrow: 1,
    height: 1,
    content: new StyledText(shortcutChunks),
  });
  const status = new TextRenderable(renderer, {
    id: "memory-status",
    height: 1,
    content: "",
  });
  footer.add(shortcuts);
  footer.add(status);

  root.add(header);
  root.add(main);
  root.add(footer);
  renderer.root.add(root);

  const setStatus = (message: string, tone: StatusTone = "normal"): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)]);
  };

  const chartWidth = (): number => {
    const panelWidth = renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH
      ? Math.floor(renderer.terminalWidth * 0.62)
      : renderer.terminalWidth;
    return Math.max(8, Math.min(60, panelWidth - 12));
  };

  const refresh = (): void => {
    const analysis = monitor.analyze();
    summary.content = summaryText(analysis, paused, intervalMs);
    trends.content = trendsText(monitor.measurements, analysis, chartWidth());
    insight.content = insightText(analysis);
  };

  const sample = (timestamp = Date.now()): MemoryMeasurement => {
    const measurement = monitor.sample(timestamp);
    refresh();
    return measurement;
  };

  const stopTimer = (): void => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const startTimer = (): void => {
    if (timer || disposed || paused) return;
    timer = setInterval(() => sample(), intervalMs);
  };

  const updateLayout = (): void => {
    const wide = renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH;
    main.flexDirection = wide ? "row" : "column";
    trendsPanel.width = wide ? "62%" : "100%";
    trendsPanel.height = wide ? "100%" : "56%";
    insightPanel.width = wide ? "38%" : "100%";
    insightPanel.height = wide ? "100%" : "44%";
    refresh();
  };

  const consume = (key: KeyEvent): void => {
    key.preventDefault();
    key.stopPropagation();
  };

  const keyHandler = (key: KeyEvent): void => {
    if ((key.ctrl && key.name === "c") || key.name === "q") {
      consume(key);
      options.onQuit?.();
      return;
    }
    if ((key.name === "escape" || key.name === "b") && options.onBack) {
      consume(key);
      options.onBack();
      return;
    }
    if (key.name === "space" || key.sequence === " ") {
      paused = !paused;
      if (paused) {
        stopTimer();
        setStatus("Paused", "warning");
      } else {
        sample();
        startTimer();
        setStatus("Monitoring resumed", "success");
      }
      refresh();
      consume(key);
      return;
    }
    if (key.name === "r") {
      monitor.reset();
      sample();
      setStatus("Baseline reset", "success");
      consume(key);
      return;
    }
    if (key.name === "g") {
      forceGarbageCollection();
      sample();
      setStatus("Forced GC and sampled", "success");
      consume(key);
    }
  };

  const resizeHandler = (): void => updateLayout();
  renderer.keyInput.on("keypress", keyHandler);
  renderer.on(CliRenderEvents.RESIZE, resizeHandler);
  updateLayout();
  if (options.autoStart !== false) {
    sample();
    startTimer();
  } else {
    refresh();
  }
  setStatus("Monitoring current process", "success");

  return {
    root,
    monitor,
    get paused() {
      return paused;
    },
    sample,
    setStatus,
    dispose() {
      if (disposed) return;
      disposed = true;
      stopTimer();
      renderer.keyInput.off("keypress", keyHandler);
      renderer.off(CliRenderEvents.RESIZE, resizeHandler);
      if (root.parent) renderer.root.remove(root);
      root.destroyRecursively();
    },
  };
}
