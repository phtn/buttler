import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core";
import {
  codeHealthIssueLabel,
  type CodeHealthAnalysis,
  type CodeHealthFileAnalysis,
  type CodeHealthSeverity,
} from "../core";
import {
  createTableSeparator,
  formatTableRow,
  padToVisualWidth,
  type TableColumn,
} from "./table";
import { theme, type ThemeColor } from "./theme";

const WIDE_LAYOUT_MIN_WIDTH = 96;

type StatusTone = "normal" | "success" | "warning" | "error";

export interface AnalyzerDashboardOptions {
  onQuit?: () => void;
  onBack?: () => void;
  onRescan?: (signal: AbortSignal) => Promise<CodeHealthAnalysis>;
}

export interface AnalyzerDashboard {
  readonly root: BoxRenderable;
  readonly fileList: SelectRenderable;
  readonly filterInput: InputRenderable;
  setAnalysis(analysis: CodeHealthAnalysis): void;
  setStatus(message: string, tone?: StatusTone): void;
  dispose(): void;
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

function severityColor(severity: CodeHealthSeverity): ThemeColor {
  switch (severity) {
    case "high":
      return theme.error;
    case "medium":
      return theme.warning;
    case "low":
      return theme.info;
  }
}

function pushLine(chunks: TextChunk[], value = "", color: ThemeColor = theme.text): void {
  chunks.push(fg(color)(`${value}\n`));
}

function detailForFile(file: CodeHealthFileAnalysis): StyledText {
  const chunks: TextChunk[] = [];
  chunks.push(bold(fg(theme.accent)(file.path)));
  pushLine(chunks);
  const high = file.issues.filter((item) => item.severity === "high").length;
  const medium = file.issues.filter((item) => item.severity === "medium").length;
  const low = file.issues.filter((item) => item.severity === "low").length;
  pushLine(chunks, `${file.issues.length} issues  ·  ${high} high  ·  ${medium} medium  ·  ${low} low`, theme.textMuted);
  pushLine(chunks);

  if (file.diagnostics.length > 0) {
    chunks.push(bold(fg(theme.error)("DIAGNOSTICS")));
    pushLine(chunks);
    for (const diagnostic of file.diagnostics) {
      const location = diagnostic.line ? `:${diagnostic.line}` : "";
      pushLine(chunks, `  × ${diagnostic.code}${location}`, theme.error);
      pushLine(chunks, `    ${diagnostic.message}`, theme.textMuted);
    }
    pushLine(chunks);
  }

  if (file.issues.length === 0) {
    pushLine(chunks, "✓ No code-health issues found", theme.success);
    return new StyledText(chunks);
  }

  for (const issue of file.issues) {
    const color = severityColor(issue.severity);
    const location = issue.line ? `:${issue.line}` : "";
    chunks.push(bold(fg(color)(`${issue.severity.toUpperCase()} · ${codeHealthIssueLabel(issue.type)}${location}`)));
    pushLine(chunks);
    pushLine(chunks, `  ${issue.message}`);
    if (issue.code) pushLine(chunks, `  ${issue.code}`, theme.textMuted);
    if (issue.suggestion) pushLine(chunks, `  → ${issue.suggestion}`, theme.info);
    pushLine(chunks);
  }
  return new StyledText(chunks);
}

function emptyDetail(filter: string): StyledText {
  return new StyledText([
    bold(fg(theme.warning)("NO MATCHES")),
    fg(theme.textMuted)(`\n\nNo files match “${filter}”. Press Esc to clear the filter.`),
  ]);
}

function summaryText(analysis: CodeHealthAnalysis): StyledText {
  const totals = analysis.totals;
  const issueColor =
    totals.parseErrors + totals.readErrors > 0 || totals.high > 0
      ? theme.error
      : totals.medium > 0
        ? theme.warning
        : theme.success;
  return new StyledText([
    fg(theme.text)(`${totals.files} 🅵`),
    fg(theme.border)("  "),
    fg(issueColor)(`${totals.issues} issues`),
    fg(theme.border)("  "),
    fg(theme.error)(`${totals.high} H`),
    fg(theme.border)("  "),
    fg(theme.warning)(`${totals.medium} M`),
    fg(theme.border)("  "),
    fg(theme.info)(`${totals.low} L`),
    fg(theme.border)("  "),
    fg(theme.textMuted)(`${analysis.durationMs}ms`),
  ]);
}

function columnsFor(availableWidth: number): TableColumn[] {
  const countWidth = 5;
  return [
    { header: "File", width: Math.max(16, availableWidth - countWidth * 3 - 3) },
    { header: "High", width: countWidth, align: "center" },
    { header: "Med", width: countWidth, align: "center" },
    { header: "Low", width: countWidth, align: "center" },
  ];
}

function fileRow(file: CodeHealthFileAnalysis): Record<string, string | number> {
  return {
    File: file.path,
    High: file.issues.filter((item) => item.severity === "high").length,
    Med: file.issues.filter((item) => item.severity === "medium").length,
    Low: file.issues.filter((item) => item.severity === "low").length,
  };
}

export function createAnalyzerDashboard(
  renderer: CliRenderer,
  initialAnalysis: CodeHealthAnalysis,
  options: AnalyzerDashboardOptions = {},
): AnalyzerDashboard {
  let analysis = initialAnalysis;
  let filteredFiles: CodeHealthFileAnalysis[] = [];
  let scanning = false;
  let disposed = false;
  let scanController: AbortController | undefined;
  const project = analysis.root.split("/").pop() ?? analysis.root;

  const root = new BoxRenderable(renderer, {
    id: "analyzer-app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  });
  const header = new BoxRenderable(renderer, {
    id: "analyzer-header",
    width: "100%",
    height: 3,
    paddingX: 1,
    flexDirection: "column",
    backgroundColor: theme.surfaceRaised,
  });
  const brandSection = new BoxRenderable(renderer, {
    id: "analyzer-brand-section",
    width: "100%",
    height: 1,
    flexDirection: "row",
  });
  const resultsSection = new BoxRenderable(renderer, {
    id: "analyzer-results-section",
    width: "100%",
    height: 1,
    flexDirection: "row",
  });
  const filterSection = new BoxRenderable(renderer, {
    id: "analyzer-filter-section",
    width: "100%",
    height: 1,
    flexDirection: "row",
  });
  const brand = new TextRenderable(renderer, {
    id: "analyzer-brand",
    height: 1,
    content: new StyledText([
      fg(theme.accent)("🅿 "),
      fg(theme.border)("⧸"),
      bold(fg(theme.textMuted)(project)),
      fg(theme.border)("  ▸  "),
      bold(fg(theme.text)("⌁")),
      fg(theme.textMuted)(" Analyzer"),
      fg(theme.border)("  ▸  "),
    ]),
  });
  const summary = new TextRenderable(renderer, {
    id: "analyzer-summary",
    height: 1,
    content: summaryText(analysis),
  });
  const filterRow = new BoxRenderable(renderer, {
    id: "analyzer-filter-row",
    width: "100%",
    height: 1,
    flexDirection: "row",
  });
  const filterLabel = new TextRenderable(renderer, {
    id: "analyzer-filter-label",
    width: 4,
    height: 1,
    content: new StyledText([fg(theme.border)("❲"), fg(theme.info)("⧸"), fg(theme.border)("❳")]),
  });
  const filterInput = new InputRenderable(renderer, {
    id: "analyzer-filter",
    flexGrow: 1,
    placeholder: "search",
    textColor: theme.text,
    focusedTextColor: theme.text,
    backgroundColor: theme.surfaceRaised,
    focusedBackgroundColor: theme.surface,
    cursorColor: theme.accent,
  });
  filterRow.add(filterLabel);
  filterRow.add(filterInput);
  brandSection.add(brand);
  resultsSection.add(summary);
  filterSection.add(filterRow);
  header.add(brandSection);
  header.add(resultsSection);
  header.add(filterSection);

  const main = new BoxRenderable(renderer, {
    id: "analyzer-main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
  });
  const filePanel = new BoxRenderable(renderer, {
    id: "analyzer-file-panel",
    width: "58%",
    height: "100%",
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    backgroundColor: theme.surface,
  });
  const tableHeader = new TextRenderable(renderer, {
    id: "analyzer-table-header",
    width: "100%",
    height: 2,
    fg: theme.textMuted,
    content: "",
  });
  const fileList = new SelectRenderable(renderer, {
    id: "analyzer-file-list",
    width: "100%",
    flexGrow: 1,
    options: [],
    showDescription: false,
    showScrollIndicator: true,
    showSelectionIndicator: true,
    wrapSelection: true,
    backgroundColor: theme.surface,
    textColor: theme.textMuted,
    focusedBackgroundColor: theme.surface,
    focusedTextColor: theme.text,
    selectedBackgroundColor: theme.accentStrong,
    selectedTextColor: theme.background,
  });
  filePanel.add(tableHeader);
  filePanel.add(fileList);

  const detailPanel = new BoxRenderable(renderer, {
    id: "analyzer-detail-panel",
    width: "42%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: " DETAILS ",
    titleColor: theme.textMuted,
    backgroundColor: theme.surface,
  });
  const detailScroll = new ScrollBoxRenderable(renderer, {
    id: "analyzer-detail-scroll",
    width: "100%",
    height: "100%",
    scrollY: true,
    paddingX: 1,
    backgroundColor: theme.surface,
    viewportCulling: true,
  });
  const detail = new TextRenderable(renderer, {
    id: "analyzer-detail",
    width: "100%",
    height: "auto",
    wrapMode: "word",
    content: "",
    fg: theme.text,
  });
  detailScroll.add(detail);
  detailPanel.add(detailScroll);
  main.add(filePanel);
  main.add(detailPanel);

  const footer = new BoxRenderable(renderer, {
    id: "analyzer-footer",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const shortcutChunks: TextChunk[] = [
    fg(theme.text)(" ⛖ "),
    fg(theme.textMuted)("navigate   "),
    fg(theme.text)(" / "),
    fg(theme.textMuted)("filter   "),
    fg(theme.text)(" r "),
    fg(theme.textMuted)("rescan   "),
  ];
  if (options.onBack) shortcutChunks.push(fg(theme.text)(" Esc/b "), fg(theme.textMuted)("back   "));
  shortcutChunks.push(fg(theme.text)(" q "), fg(theme.textMuted)("quit"));
  const shortcuts = new TextRenderable(renderer, {
    id: "analyzer-shortcuts",
    flexGrow: 1,
    height: 1,
    content: new StyledText(shortcutChunks),
  });
  const status = new TextRenderable(renderer, {
    id: "analyzer-status",
    height: 1,
    content: "",
  });
  footer.add(shortcuts);
  footer.add(status);

  root.add(header);
  root.add(main);
  root.add(footer);
  renderer.root.add(root);

  const availableTableWidth = (): number => {
    const panelWidth = renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH
      ? Math.floor(renderer.terminalWidth * 0.58)
      : renderer.terminalWidth;
    return Math.max(34, panelWidth - 6);
  };

  const updateDetail = (file: CodeHealthFileAnalysis | undefined): void => {
    detail.content = file ? detailForFile(file) : emptyDetail(filterInput.value);
    detailScroll.scrollTo(0);
  };

  const refreshRows = (preferredPath?: string): void => {
    const selected = fileList.getSelectedOption()?.value as CodeHealthFileAnalysis | undefined;
    const rememberedPath = preferredPath ?? selected?.path;
    const query = filterInput.value.trim().toLocaleLowerCase();
    filteredFiles = analysis.files.filter((file) => file.path.toLocaleLowerCase().includes(query));
    const columns = columnsFor(availableTableWidth());
    tableHeader.content = `${columns
      .map((column) => padToVisualWidth(column.header, column.width, column.align ?? "left"))
      .join(" ")}\n${createTableSeparator(columns)}`;
    fileList.options = filteredFiles.map((file) => ({
      name: formatTableRow(columns, fileRow(file)),
      description: "",
      value: file,
    }));
    if (filteredFiles.length === 0) {
      updateDetail(undefined);
      return;
    }
    const rememberedIndex = filteredFiles.findIndex((file) => file.path === rememberedPath);
    fileList.setSelectedIndex(Math.max(0, rememberedIndex));
    updateDetail(filteredFiles[fileList.getSelectedIndex()]);
  };

  const updateLayout = (): void => {
    const wide = renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH;
    header.height = wide ? 1 : 3;
    header.flexDirection = wide ? "row" : "column";
    for (const section of [brandSection, resultsSection, filterSection]) {
      section.width = wide ? "auto" : "100%";
      section.flexGrow = wide ? 1 : 0;
      section.flexBasis = wide ? 0 : "auto";
    }
    resultsSection.justifyContent = wide ? "center" : "flex-start";
    filterSection.justifyContent = wide ? "flex-end" : "flex-start";
    filterRow.width = wide ? 24 : "100%";
    main.flexDirection = wide ? "row" : "column";
    filePanel.width = wide ? "58%" : "100%";
    filePanel.height = wide ? "100%" : "56%";
    detailPanel.width = wide ? "42%" : "100%";
    detailPanel.height = wide ? "100%" : "44%";
    refreshRows();
  };

  const setStatus = (message: string, tone: StatusTone = "normal"): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)]);
  };

  const setAnalysis = (nextAnalysis: CodeHealthAnalysis): void => {
    analysis = nextAnalysis;
    summary.content = summaryText(analysis);
    filePanel.title = ` FILES · ${analysis.files.length} `;
    refreshRows();
  };

  const rescan = async (): Promise<void> => {
    if (!options.onRescan || scanning) return;
    scanning = true;
    scanController = new AbortController();
    setStatus("Scanning…", "warning");
    try {
      setAnalysis(await options.onRescan(scanController.signal));
      if (!disposed) setStatus("Scan complete", "success");
    } catch (error) {
      if (!disposed && !scanController.signal.aborted) {
        setStatus(error instanceof Error ? error.message : String(error), "error");
      }
    } finally {
      scanning = false;
      scanController = undefined;
    }
  };

  const consume = (key: KeyEvent): void => {
    key.preventDefault();
    key.stopPropagation();
  };

  const keyHandler = (key: KeyEvent): void => {
    const filterFocused = renderer.currentFocusedRenderable === filterInput;
    if (filterFocused) {
      if (key.name === "escape") {
        filterInput.value = "";
        refreshRows();
        fileList.focus();
        consume(key);
      } else if (key.name === "tab") {
        fileList.focus();
        consume(key);
      }
      return;
    }
    if ((key.ctrl && key.name === "c") || key.name === "q") {
      consume(key);
      options.onQuit?.();
      return;
    }
    if (options.onBack && (key.name === "escape" || key.name === "b")) {
      consume(key);
      scanController?.abort();
      options.onBack();
      return;
    }
    if (key.name === "/" || key.sequence === "/" || key.name === "tab") {
      filterInput.focus();
      consume(key);
      return;
    }
    if (key.name === "r") {
      consume(key);
      void rescan();
    }
  };

  const selectionHandler = (index: number, option: { value?: unknown } | null): void => {
    updateDetail((option?.value as CodeHealthFileAnalysis | undefined) ?? filteredFiles[index]);
  };
  const filterHandler = (): void => refreshRows();
  const filterSubmitHandler = (): void => fileList.focus();
  const resizeHandler = (): void => updateLayout();

  renderer.keyInput.on("keypress", keyHandler);
  renderer.on(CliRenderEvents.RESIZE, resizeHandler);
  fileList.on(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler);
  filterInput.on(InputRenderableEvents.INPUT, filterHandler);
  filterInput.on(InputRenderableEvents.ENTER, filterSubmitHandler);
  updateLayout();
  fileList.focus();
  setStatus(
    analysis.totals.parseErrors + analysis.totals.readErrors > 0
      ? `${analysis.totals.parseErrors + analysis.totals.readErrors} files could not be analyzed`
      : analysis.totals.high > 0
      ? `${analysis.totals.high} high severity`
      : analysis.totals.medium > 0
        ? `${analysis.totals.medium} medium severity`
        : "Clean",
    analysis.totals.parseErrors + analysis.totals.readErrors > 0 || analysis.totals.high > 0
      ? "error"
      : analysis.totals.medium > 0
        ? "warning"
        : "success",
  );

  return {
    root,
    fileList,
    filterInput,
    setAnalysis,
    setStatus,
    dispose() {
      if (disposed) return;
      disposed = true;
      scanController?.abort();
      renderer.keyInput.off("keypress", keyHandler);
      renderer.off(CliRenderEvents.RESIZE, resizeHandler);
      fileList.off(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler);
      filterInput.off(InputRenderableEvents.INPUT, filterHandler);
      filterInput.off(InputRenderableEvents.ENTER, filterSubmitHandler);
      if (root.parent) renderer.root.remove(root);
      root.destroyRecursively();
    },
  };
}
