import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  StyledText,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
  type TextChunk,
} from "@opentui/core";
import {
  adjustAlacrittyValue,
  buildAlacrittyConfig,
  ALACRITTY_SETTINGS,
  alacrittyConfigWarnings,
  loadAlacrittyConfig,
  saveAlacrittyConfig,
  validateAlacrittyValue,
  type AlacrittyConfigSaveResult,
  type AlacrittyConfigSnapshot,
  type AlacrittySettingDefinition,
} from "../core";
import { padToVisualWidth, truncateToVisualWidth } from "./table";
import { theme, type ThemeColor } from "./theme";

type StatusTone = "normal" | "success" | "warning" | "error";

const WIDE_LAYOUT_MIN_WIDTH = 90;

export interface AlacrittyDashboardOptions {
  onQuit?: () => void;
  onBack?: () => void;
  onSave?: (
    snapshot: AlacrittyConfigSnapshot,
    values: Record<string, string>,
  ) => Promise<AlacrittyConfigSaveResult>;
  onReload?: () => Promise<AlacrittyConfigSnapshot>;
}

export interface AlacrittyDashboard {
  readonly root: BoxRenderable;
  readonly settingList: SelectRenderable;
  readonly configPathInput: InputRenderable;
  readonly valueInput: InputRenderable;
  readonly values: Readonly<Record<string, string>>;
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
    case "normal":
    default:
      return theme.textMuted;
  }
}

function pushLine(chunks: TextChunk[], value = "", color: ThemeColor = theme.text): void {
  chunks.push(fg(color)(`${value}\n`));
}

function sourceLabel(
  definition: AlacrittySettingDefinition,
  snapshot: AlacrittyConfigSnapshot,
  values: Record<string, string>,
): { label: string; color: ThemeColor } {
  if (values[definition.path] !== snapshot.values[definition.path]) {
    return { label: "unsaved change", color: theme.warning };
  }
  if (snapshot.managedValues[definition.path] !== undefined) {
    return { label: "Buttler override", color: theme.accent };
  }
  if (snapshot.baseValues[definition.path] !== definition.defaultValue) {
    return { label: "alacritty.toml", color: theme.info };
  }
  return { label: "Alacritty default", color: theme.textMuted };
}

function settingDetail(
  definition: AlacrittySettingDefinition,
  snapshot: AlacrittyConfigSnapshot,
  values: Record<string, string>,
): StyledText {
  const chunks: TextChunk[] = [];
  const source = sourceLabel(definition, snapshot, values);

  chunks.push(bold(fg(theme.accent)(definition.group.toUpperCase())));
  pushLine(chunks);
  chunks.push(bold(fg(theme.text)(definition.label)));
  pushLine(chunks);
  pushLine(chunks, definition.path, theme.textMuted);
  pushLine(chunks);
  pushLine(chunks, definition.description);
  pushLine(chunks);
  chunks.push(fg(theme.textMuted)("Value  "));
  chunks.push(bold(fg(theme.text)(values[definition.path] ?? definition.defaultValue)));
  pushLine(chunks);
  chunks.push(fg(theme.textMuted)("Source "));
  chunks.push(fg(source.color)(source.label));
  pushLine(chunks);

  if (definition.choices) {
    pushLine(chunks);
    pushLine(chunks, `Choices: ${definition.choices.join("  ·  ")}`, theme.textMuted);
  } else if (definition.kind === "number") {
    pushLine(chunks);
    const range =
      definition.min !== undefined && definition.max !== undefined
        ? `${definition.min}–${definition.max}`
        : "numeric";
    pushLine(chunks, `Range: ${range}  ·  Step: ${definition.step ?? 1}`, theme.textMuted);
  }

  const warnings = alacrittyConfigWarnings(values);
  if (warnings.length > 0 || snapshot.issues.length > 0) {
    pushLine(chunks);
    for (const warning of warnings) pushLine(chunks, `! ${warning}`, theme.warning);
    for (const issue of snapshot.issues.slice(0, 3)) pushLine(chunks, `! ${issue.message}`, theme.error);
  }

  pushLine(chunks);
  pushLine(
    chunks,
    definition.kind === "text"
      ? "Press Enter to edit the exact value."
      : "Use ←/→ to adjust, or Enter for an exact value.",
    theme.textMuted,
  );
  return new StyledText(chunks);
}

function settingRow(definition: AlacrittySettingDefinition, value: string, width: number): string {
  const groupWidth = 9;
  const valueWidth = Math.max(8, Math.min(24, Math.floor(width * 0.34)));
  const labelWidth = Math.max(8, width - groupWidth - valueWidth - 2);
  return [
    padToVisualWidth(definition.group.toUpperCase(), groupWidth),
    padToVisualWidth(truncateToVisualWidth(definition.label, labelWidth), labelWidth),
    padToVisualWidth(truncateToVisualWidth(value, valueWidth), valueWidth, "right"),
  ].join(" ");
}

export function createAlacrittyDashboard(
  renderer: CliRenderer,
  initialSnapshot: AlacrittyConfigSnapshot,
  options: AlacrittyDashboardOptions = {},
): AlacrittyDashboard {
  let snapshot = initialSnapshot;
  let values = { ...snapshot.values };
  let saving = false;
  let disposed = false;
  let ignoreSubmittedEnter = false;
  let discardArmed = false;

  const root = new BoxRenderable(renderer, {
    id: "alacritty-app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
  });

  const header = new BoxRenderable(renderer, {
    id: "alacritty-header",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const brandSection = new BoxRenderable(renderer, {
    id: "alacritty-brand-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
  });
  const pathSection = new BoxRenderable(renderer, {
    id: "alacritty-path-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
    justifyContent: "center",
  });
  const summarySection = new BoxRenderable(renderer, {
    id: "alacritty-summary-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
  });
  const brand = new TextRenderable(renderer, {
    id: "alacritty-brand",
    height: 1,
    content: new StyledText([
      fg(theme.accent)("🅿 "),
      fg(theme.border)("⧸  ▸  "),
      bold(fg(theme.text)("A")),
      fg(theme.textMuted)(" Alacritty"),
    ]),
  });
  const configPathLabel = new TextRenderable(renderer, {
    id: "alacritty-config-path-label",
    width: 8,
    height: 1,
    content: new StyledText([
      fg(theme.border)("⟨"),
      fg(theme.info)("path"),
      fg(theme.border)("⟩ "),
    ]),
  });
  const configPathInput = new InputRenderable(renderer, {
    id: "alacritty-config-path",
    flexGrow: 1,
    value: snapshot.path,
    placeholder: "alacritty.toml path",
    textColor: theme.textMuted,
    focusedTextColor: theme.text,
    backgroundColor: theme.surfaceRaised,
    focusedBackgroundColor: theme.surfaceRaised,
    cursorColor: theme.accent,
  });
  const summary = new TextRenderable(renderer, {
    id: "alacritty-summary",
    height: 1,
    content: "",
  });
  brandSection.add(brand);
  pathSection.add(configPathLabel);
  pathSection.add(configPathInput);
  summarySection.add(summary);
  header.add(brandSection);
  header.add(pathSection);
  header.add(summarySection);

  const main = new BoxRenderable(renderer, {
    id: "alacritty-main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
  });
  const settingsPanel = new BoxRenderable(renderer, {
    id: "alacritty-settings-panel",
    width: "56%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: ` SETTINGS · ${ALACRITTY_SETTINGS.length} `,
    titleColor: theme.textMuted,
    backgroundColor: theme.surface,
  });
  const settingList = new SelectRenderable(renderer, {
    id: "alacritty-setting-list",
    width: "100%",
    height: "100%",
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
  settingsPanel.add(settingList);

  const detailPanel = new BoxRenderable(renderer, {
    id: "alacritty-detail-panel",
    width: "44%",
    height: "100%",
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: " CONFIGURE ",
    titleColor: theme.textMuted,
    backgroundColor: theme.surface,
  });
  const detail = new TextRenderable(renderer, {
    id: "alacritty-detail",
    width: "100%",
    flexGrow: 1,
    height: "auto",
    wrapMode: "word",
    content: "",
    fg: theme.text,
  });
  const editorLabel = new TextRenderable(renderer, {
    id: "alacritty-editor-label",
    width: "100%",
    height: 1,
    content: new StyledText([bold(fg(theme.textMuted)(" EDIT VALUE "))]),
  });
  const valueInput = new InputRenderable(renderer, {
    id: "alacritty-value-input",
    width: "100%",
    value: "",
    placeholder: "value",
    textColor: theme.textMuted,
    focusedTextColor: theme.text,
    backgroundColor: theme.surfaceRaised,
    focusedBackgroundColor: theme.surfaceRaised,
    cursorColor: theme.accent,
  });
  detailPanel.add(detail);
  detailPanel.add(editorLabel);
  detailPanel.add(valueInput);
  main.add(settingsPanel);
  main.add(detailPanel);

  const footer = new BoxRenderable(renderer, {
    id: "alacritty-footer",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const shortcuts = new TextRenderable(renderer, {
    id: "alacritty-shortcuts",
    flexGrow: 1,
    height: 1,
    content: new StyledText([
      fg(theme.text)(" ↑↓ "),
      fg(theme.textMuted)("select  "),
      fg(theme.text)(" ←→ "),
      fg(theme.textMuted)("adjust  "),
      fg(theme.text)(" enter "),
      fg(theme.textMuted)("edit  "),
      fg(theme.text)(" x "),
      fg(theme.textMuted)("reset  "),
      fg(theme.text)(" s "),
      fg(theme.textMuted)("save  "),
      fg(theme.text)(" r "),
      fg(theme.textMuted)("reload  "),
      fg(theme.text)(" p "),
      fg(theme.textMuted)("path  "),
      ...(options.onBack ? [fg(theme.text)(" Esc/b "), fg(theme.textMuted)("back  ")] : []),
      fg(theme.text)(" q "),
      fg(theme.textMuted)("quit"),
    ]),
  });
  const status = new TextRenderable(renderer, {
    id: "alacritty-status",
    height: 1,
    content: "",
  });
  footer.add(shortcuts);
  footer.add(status);

  root.add(header);
  root.add(main);
  root.add(footer);
  renderer.root.add(root);

  const selectedDefinition = (): AlacrittySettingDefinition =>
    (settingList.getSelectedOption()?.value as AlacrittySettingDefinition | undefined) ?? ALACRITTY_SETTINGS[0]!;

  const isDirty = (): boolean => buildAlacrittyConfig(snapshot.source, values) !== snapshot.source;

  const setStatus = (message: string, tone: StatusTone = "normal"): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)]);
  };

  const refreshSummary = (): void => {
    const warnings = alacrittyConfigWarnings(values).length + snapshot.issues.length;
    summary.content = new StyledText([
      fg(isDirty() ? theme.warning : theme.success)(isDirty() ? "● unsaved" : "✓ saved"),
      ...(warnings > 0 ? [fg(theme.border)("  "), fg(theme.warning)(`${warnings} warning`)] : []),
    ]);
  };

  const refreshDetail = (): void => {
    const definition = selectedDefinition();
    detail.content = settingDetail(definition, snapshot, values);
    if (renderer.currentFocusedRenderable !== valueInput) {
      valueInput.value = values[definition.path] ?? definition.defaultValue;
    }
    refreshSummary();
  };

  const refreshPathInput = (): void => {
    if (renderer.currentFocusedRenderable !== configPathInput) {
      configPathInput.value = snapshot.path;
    }
  };

  const refreshRows = (): void => {
    const selectedKey = selectedDefinition().path;
    const availableWidth = Math.max(28, settingsPanel.width - 3);
    settingList.options = ALACRITTY_SETTINGS.map((definition) => ({
      name: settingRow(definition, values[definition.path] ?? definition.defaultValue, availableWidth),
      description: "",
      value: definition,
    }));
    const index = ALACRITTY_SETTINGS.findIndex((definition) => definition.path === selectedKey);
    settingList.setSelectedIndex(Math.max(0, index));
    refreshPathInput();
    refreshDetail();
  };

  const updateLayout = (): void => {
    const wide = renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH;
    header.height = wide ? 1 : 3;
    header.flexDirection = wide ? "row" : "column";
    for (const section of [brandSection, pathSection, summarySection]) {
      section.width = wide ? "auto" : "100%";
      section.flexGrow = wide ? 1 : 0;
      section.flexBasis = wide ? 0 : "auto";
    }
    pathSection.justifyContent = wide ? "center" : "flex-start";
    summarySection.justifyContent = wide ? "flex-end" : "flex-start";
    main.flexDirection = wide ? "row" : "column";
    settingsPanel.width = wide ? "56%" : "100%";
    settingsPanel.height = wide ? "100%" : "55%";
    detailPanel.width = wide ? "44%" : "100%";
    detailPanel.height = wide ? "100%" : "45%";
    refreshRows();
  };

  const adjust = (direction: -1 | 1): void => {
    const definition = selectedDefinition();
    if (definition.kind === "text") {
      setStatus("Press Enter to edit this value", "normal");
      return;
    }
    discardArmed = false;
    values[definition.path] = adjustAlacrittyValue(definition, values[definition.path]!, direction);
    refreshRows();
    setStatus(`${definition.label}: ${values[definition.path]}`, "warning");
  };

  const edit = (): void => {
    const definition = selectedDefinition();
    valueInput.value = values[definition.path] ?? definition.defaultValue;
    valueInput.focus();
    setStatus(`Editing ${definition.label} · Enter applies · Esc cancels`, "normal");
  };

  const editPath = (): void => {
    configPathInput.value = "";
    configPathInput.focus();
    setStatus("Editing Alacritty config path · Enter loads · Esc cancels", "normal");
  };

  const resetSelected = (): void => {
    const definition = selectedDefinition();
    discardArmed = false;
    values[definition.path] = snapshot.baseValues[definition.path] ?? definition.defaultValue;
    refreshRows();
    setStatus(`${definition.label} reset to underlying config`, "warning");
  };

  const submitPath = async (): Promise<void> => {
    if (saving) return;

    const nextPath = configPathInput.value.trim();
    if (!nextPath) {
      configPathInput.value = snapshot.path;
      setStatus("Config path cannot be empty", "error");
      return;
    }

    if (nextPath === snapshot.path) {
      configPathInput.value = snapshot.path;
      settingList.focus();
      setStatus("Config path unchanged", "normal");
      return;
    }

    if (isDirty()) {
      configPathInput.value = snapshot.path;
      settingList.focus();
      setStatus("Save or reset changes before changing the config path", "warning");
      return;
    }

    saving = true;
    setStatus("Loading config path…", "warning");
    try {
      snapshot = await loadAlacrittyConfig(nextPath);
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      refreshRows();
      settingList.focus();
      setStatus(snapshot.exists ? "Loaded config path" : "New config path · save to create it", "success");
    } catch (error) {
      configPathInput.value = snapshot.path;
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      saving = false;
    }
  };

  const save = async (): Promise<void> => {
    if (saving || !isDirty()) {
      if (!saving) setStatus("No changes to save", "normal");
      return;
    }
    saving = true;
    setStatus("Saving…", "warning");
    try {
      const result = await (options.onSave ?? saveAlacrittyConfig)(snapshot, values);
      snapshot = result;
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      refreshRows();
      setStatus(result.backupPath ? "Saved · backup updated · Alacritty auto-reloads" : "Saved · Alacritty auto-reloads", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      saving = false;
    }
  };

  const reload = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    setStatus("Reloading from disk…", "warning");
    try {
      snapshot = await (options.onReload ?? (() => loadAlacrittyConfig(snapshot.path)))();
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      refreshRows();
      setStatus("Reloaded from disk", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      saving = false;
    }
  };

  const canDiscard = (): boolean => {
    if (!isDirty() || discardArmed) return true;
    discardArmed = true;
    setStatus("Unsaved changes · press back or q again to discard", "warning");
    return false;
  };

  const consume = (key: KeyEvent): void => {
    key.preventDefault();
    key.stopPropagation();
  };

  const keyHandler = (key: KeyEvent): void => {
    if (renderer.currentFocusedRenderable === valueInput || renderer.currentFocusedRenderable === configPathInput) {
      if (key.name === "escape") {
        if (renderer.currentFocusedRenderable === valueInput) {
          valueInput.value = values[selectedDefinition().path]!;
        } else {
          configPathInput.value = snapshot.path;
        }
        settingList.focus();
        setStatus("Edit cancelled", "normal");
        consume(key);
      }
      return;
    }

    if (ignoreSubmittedEnter && (key.name === "return" || key.name === "enter" || key.sequence === "\r")) {
      consume(key);
      return;
    }
    if (key.ctrl && key.name === "c") {
      consume(key);
      options.onQuit?.();
      return;
    }
    if (saving) {
      consume(key);
      return;
    }
    if (key.name === "q") {
      consume(key);
      if (canDiscard()) options.onQuit?.();
      return;
    }
    if (options.onBack && (key.name === "escape" || key.name === "b")) {
      consume(key);
      if (canDiscard()) options.onBack();
      return;
    }
    if (key.name === "left" || key.name === "h") {
      consume(key);
      adjust(-1);
    } else if (key.name === "right" || key.name === "l") {
      consume(key);
      adjust(1);
    } else if (key.name === "return" || key.name === "enter" || key.sequence === "\r") {
      consume(key);
      edit();
    } else if (key.name === "x") {
      consume(key);
      resetSelected();
    } else if (key.name === "s") {
      consume(key);
      void save();
    } else if (key.name === "r") {
      consume(key);
      void reload();
    } else if (key.name === "p") {
      consume(key);
      editPath();
    }
  };

  const selectionHandler = (): void => refreshDetail();
  const inputSubmitHandler = (): void => {
    const definition = selectedDefinition();
    try {
      values[definition.path] = validateAlacrittyValue(definition, valueInput.value);
      discardArmed = false;
      ignoreSubmittedEnter = true;
      queueMicrotask(() => {
        ignoreSubmittedEnter = false;
      });
      settingList.focus();
      refreshRows();
      setStatus(`${definition.label}: ${values[definition.path]}`, "warning");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  };
  const pathSubmitHandler = (): void => {
    void submitPath();
  };
  const resizeHandler = (): void => updateLayout();

  renderer.keyInput.on("keypress", keyHandler);
  renderer.on(CliRenderEvents.RESIZE, resizeHandler);
  settingList.on(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler);
  valueInput.on(InputRenderableEvents.ENTER, inputSubmitHandler);
  configPathInput.on(InputRenderableEvents.ENTER, pathSubmitHandler);
  updateLayout();
  settingList.focus();
  setStatus(snapshot.exists ? "Ready" : "New config · save to create it", "normal");

  return {
    root,
    settingList,
    configPathInput,
    valueInput,
    get values() {
      return values;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      renderer.keyInput.off("keypress", keyHandler);
      renderer.off(CliRenderEvents.RESIZE, resizeHandler);
      settingList.off(SelectRenderableEvents.SELECTION_CHANGED, selectionHandler);
      valueInput.off(InputRenderableEvents.ENTER, inputSubmitHandler);
      configPathInput.off(InputRenderableEvents.ENTER, pathSubmitHandler);
      if (root.parent) renderer.root.remove(root);
      root.destroyRecursively();
    },
  };
}
