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
  adjustHerdrValue,
  buildHerdrConfig,
  HERDR_SETTINGS,
  herdrConfigWarnings,
  loadHerdrConfig,
  saveHerdrConfig,
  validateHerdrValue,
  type HerdrConfigSaveResult,
  type HerdrConfigSnapshot,
  type HerdrSettingDefinition,
  type HerdrSettingGroup,
} from "../core";
import { getVisualWidth, padToVisualWidth, truncateToVisualWidth } from "./table";
import { theme, type ThemeColor } from "./theme";

type StatusTone = "normal" | "success" | "warning" | "error";
export type HerdrDashboardView = "categories" | "settings";

const WIDE_LAYOUT_MIN_WIDTH = 90;
const SETTINGS_PANEL_RATIO = 0.64;
const CATEGORY_TILE_WIDTH = 17;
const CATEGORY_COMPACT_TILE_WIDTH = 15;
const CATEGORY_TILE_HEIGHT = 4;
const CATEGORY_COMPACT_TILE_HEIGHT = 3;
const CATEGORY_TILE_GAP = 1;
const CATEGORY_GRID_PADDING_X = 1;

interface HerdrCategoryPresentation {
  glyph: string;
  description: string;
}

export interface HerdrSettingCategory extends HerdrCategoryPresentation {
  id: string;
  group: HerdrSettingGroup;
  settings: readonly HerdrSettingDefinition[];
}

const CATEGORY_PRESENTATION: Record<HerdrSettingGroup, HerdrCategoryPresentation> = {
  General: {
    glyph: "◆",
    description: "First-run setup and app-wide Herdr behavior.",
  },
  Theme: {
    glyph: "◐",
    description: "Theme selection and automatic light or dark appearance switching.",
  },
  Terminal: {
    glyph: ">_",
    description: "Shell startup and working-directory behavior for new panes.",
  },
  Updates: {
    glyph: "↻",
    description: "Release channels and automatic version or manifest checks.",
  },
  Keys: {
    glyph: "⌘",
    description: "Command, navigation, pane, tab, workspace, and agent shortcuts.",
  },
  UI: {
    glyph: "▦",
    description: "Sidebar, tabs, panes, status line, and layout presentation.",
  },
  Toast: {
    glyph: "!",
    description: "Notification placement, timing, filtering, and visual behavior.",
  },
  Sound: {
    glyph: "♪",
    description: "Notification sounds, volume, playback commands, and sound packs.",
  },
  Session: {
    glyph: "◎",
    description: "Persistent session identity and session-level defaults.",
  },
  Worktrees: {
    glyph: "⑂",
    description: "Git worktree defaults and managed worktree behavior.",
  },
  Remote: {
    glyph: "↗",
    description: "Remote-session behavior and host integration.",
  },
  Advanced: {
    glyph: "⚙",
    description: "Low-level controls intended for experienced Herdr users.",
  },
  Labs: {
    glyph: "◇",
    description: "Experimental features that may evolve between releases.",
  },
};

function categoryId(group: HerdrSettingGroup): string {
  return group.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export const HERDR_SETTING_CATEGORIES: readonly HerdrSettingCategory[] = [
  ...new Set(HERDR_SETTINGS.map((definition) => definition.group)),
].map((group) => ({
  id: categoryId(group),
  group,
  ...CATEGORY_PRESENTATION[group],
  settings: HERDR_SETTINGS.filter((definition) => definition.group === group),
}));

export async function reloadHerdrServerConfig(): Promise<void> {
  const child = Bun.spawn(["herdr", "server", "reload-config"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    const output = stderr.trim() || stdout.trim();
    throw new Error(output || `herdr server reload-config exited with code ${exitCode}`);
  }
}

export interface HerdrDashboardOptions {
  onQuit?: () => void;
  onBack?: () => void;
  onSave?: (
    snapshot: HerdrConfigSnapshot,
    values: Record<string, string>,
  ) => Promise<HerdrConfigSaveResult>;
  onReload?: () => Promise<HerdrConfigSnapshot>;
  onApplyConfig?: () => Promise<void>;
}

export interface HerdrDashboard {
  readonly root: BoxRenderable;
  readonly settingList: SelectRenderable;
  readonly configPathInput: InputRenderable;
  readonly valueInput: InputRenderable;
  readonly values: Readonly<Record<string, string>>;
  readonly view: HerdrDashboardView;
  readonly selectedCategory: HerdrSettingCategory;
  openCategory(group: HerdrSettingGroup): void;
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
  definition: HerdrSettingDefinition,
  snapshot: HerdrConfigSnapshot,
  values: Record<string, string>,
): { label: string; color: ThemeColor } {
  if (values[definition.path] !== snapshot.values[definition.path]) {
    return { label: "unsaved change", color: theme.warning };
  }
  if (snapshot.configuredValues[definition.path] !== undefined) {
    return { label: "config.toml", color: theme.info };
  }
  return { label: "Herdr default", color: theme.textMuted };
}

function settingDetail(
  definition: HerdrSettingDefinition,
  snapshot: HerdrConfigSnapshot,
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
  if (definition.allowArray) {
    pushLine(chunks);
    pushLine(chunks, 'Multiple: ["prefix+n", "ctrl+alt+n"]', theme.textMuted);
  }

  const warnings = herdrConfigWarnings(values);
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

function settingRow(definition: HerdrSettingDefinition, value: string, width: number): string {
  const valueWidth = Math.max(10, Math.min(28, Math.floor(width * 0.38)));
  const labelWidth = Math.max(10, width - valueWidth - 1);
  return [
    padToVisualWidth(truncateToVisualWidth(definition.label, labelWidth), labelWidth),
    padToVisualWidth(truncateToVisualWidth(value, valueWidth), valueWidth, "right"),
  ].join(" ");
}

function categoryDetail(category: HerdrSettingCategory): StyledText {
  const chunks: TextChunk[] = [];
  const preview = category.settings.slice(0, 6);
  const remaining = category.settings.length - preview.length;

  chunks.push(bold(fg(theme.accent)(category.group.toUpperCase())));
  pushLine(chunks);
  pushLine(chunks);
  pushLine(chunks, category.description);
  pushLine(chunks);
  chunks.push(fg(theme.textMuted)("Settings "));
  chunks.push(bold(fg(theme.text)(String(category.settings.length))));
  pushLine(chunks);
  pushLine(chunks);
  pushLine(chunks, "Includes", theme.textMuted);
  for (const definition of preview) pushLine(chunks, `· ${definition.label}`);
  if (remaining > 0) pushLine(chunks, `· ${remaining} more…`, theme.textMuted);
  pushLine(chunks);
  pushLine(chunks, "Press Enter to open this category.", theme.textMuted);

  return new StyledText(chunks);
}

function categoryTile(category: HerdrSettingCategory, width: number, compact: boolean): StyledText {
  const innerWidth = width - 2;
  const name = truncateToVisualWidth(category.group.toUpperCase(), innerWidth - getVisualWidth(category.glyph) - 1);
  const labelWidth = getVisualWidth(category.glyph) + 1 + getVisualWidth(name);
  const leftPadding = Math.max(0, Math.floor((innerWidth - labelWidth) / 2));
  const rightPadding = Math.max(0, innerWidth - labelWidth - leftPadding);
  const count = `${category.settings.length} ${category.settings.length === 1 ? "setting" : "settings"}`;

  return new StyledText([
    fg(theme.text)(" ".repeat(leftPadding)),
    bold(fg(theme.accent)(`${category.glyph} `)),
    bold(fg(theme.text)(`${name}${" ".repeat(rightPadding)}${compact ? "" : "\n"}`)),
    ...(compact ? [] : [fg(theme.textMuted)(padToVisualWidth(count, innerWidth, "center"))]),
  ]);
}

export function createHerdrDashboard(
  renderer: CliRenderer,
  initialSnapshot: HerdrConfigSnapshot,
  options: HerdrDashboardOptions = {},
): HerdrDashboard {
  let snapshot = initialSnapshot;
  let values = { ...snapshot.values };
  let view: HerdrDashboardView = "categories";
  let selectedCategoryIndex = 0;
  let saving = false;
  let reloadPrompt = false;
  let disposed = false;
  let ignoreSubmittedEnter = false;
  let discardArmed = false;

  const root = new BoxRenderable(renderer, {
    id: "herdr-app",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: theme.background,
    focusable: true,
  });

  const header = new BoxRenderable(renderer, {
    id: "herdr-header",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const brandSection = new BoxRenderable(renderer, {
    id: "herdr-brand-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
  });
  const pathSection = new BoxRenderable(renderer, {
    id: "herdr-path-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
    justifyContent: "center",
  });
  const summarySection = new BoxRenderable(renderer, {
    id: "herdr-summary-section",
    height: 1,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
    justifyContent: "flex-end",
  });
  const brand = new TextRenderable(renderer, {
    id: "herdr-brand",
    height: 1,
    content: new StyledText([
      fg(theme.accent)("🅿 "),
      fg(theme.border)("⧸  ▸  "),
      bold(fg(theme.text)("H")),
      fg(theme.textMuted)(" Herdr"),
    ]),
  });
  const configPathLabel = new TextRenderable(renderer, {
    id: "herdr-config-path-label",
    width: 8,
    height: 1,
    content: new StyledText([
      fg(theme.border)("⟨"),
      fg(theme.info)("path"),
      fg(theme.border)("⟩ "),
    ]),
  });
  const configPathInput = new InputRenderable(renderer, {
    id: "herdr-config-path",
    flexGrow: 1,
    value: snapshot.path,
    placeholder: "config.toml path",
    textColor: theme.textMuted,
    focusedTextColor: theme.text,
    backgroundColor: theme.surfaceRaised,
    focusedBackgroundColor: theme.surfaceRaised,
    cursorColor: theme.accent,
  });
  const summary = new TextRenderable(renderer, {
    id: "herdr-summary",
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
    id: "herdr-main",
    width: "100%",
    flexGrow: 1,
    flexDirection: "row",
  });
  const settingsPanel = new BoxRenderable(renderer, {
    id: "herdr-settings-panel",
    width: "64%",
    height: "100%",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: ` CATEGORIES · ${HERDR_SETTING_CATEGORIES.length} `,
    titleColor: theme.textMuted,
    backgroundColor: theme.surface,
  });
  const categoryGrid = new BoxRenderable(renderer, {
    id: "herdr-category-grid",
    width: "100%",
    height: "100%",
    paddingX: CATEGORY_GRID_PADDING_X,
    paddingY: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: CATEGORY_TILE_GAP,
    rowGap: CATEGORY_TILE_GAP,
    alignItems: "flex-start",
    backgroundColor: theme.surface,
    overflow: "hidden",
  });
  const settingList = new SelectRenderable(renderer, {
    id: "herdr-setting-list",
    width: "100%",
    height: "100%",
    visible: false,
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
  const categoryTiles = HERDR_SETTING_CATEGORIES.map((category) => {
    const tile = new BoxRenderable(renderer, {
      id: `herdr-category-${category.id}`,
      width: CATEGORY_TILE_WIDTH,
      height: CATEGORY_TILE_HEIGHT,
      border: true,
      borderStyle: "single",
      borderColor: theme.border,
      flexDirection: "column",
      justifyContent: "center",
      backgroundColor: theme.surface,
    });
    const thumbnail = new TextRenderable(renderer, {
      id: `herdr-category-${category.id}-thumbnail`,
      width: "100%",
      height: 2,
      content: categoryTile(category, CATEGORY_TILE_WIDTH, false),
    });
    tile.add(thumbnail);
    categoryGrid.add(tile);
    return { tile, thumbnail };
  });
  settingsPanel.add(categoryGrid);
  settingsPanel.add(settingList);

  const detailPanel = new BoxRenderable(renderer, {
    id: "herdr-detail-panel",
    width: "36%",
    height: "100%",
    paddingX: 1,
    flexDirection: "column",
    border: true,
    borderStyle: "single",
    borderColor: theme.border,
    title: " CATEGORY ",
    titleColor: theme.textMuted,
    backgroundColor: theme.surface,
  });
  const detail = new TextRenderable(renderer, {
    id: "herdr-detail",
    width: "100%",
    flexGrow: 1,
    height: "auto",
    wrapMode: "word",
    content: "",
    fg: theme.text,
  });
  const editorLabel = new TextRenderable(renderer, {
    id: "herdr-editor-label",
    width: "100%",
    height: 1,
    visible: false,
    content: new StyledText([bold(fg(theme.textMuted)(" EDIT VALUE "))]),
  });
  const valueInput = new InputRenderable(renderer, {
    id: "herdr-value-input",
    width: "100%",
    visible: false,
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
    id: "herdr-footer",
    width: "100%",
    height: 1,
    paddingX: 1,
    flexDirection: "row",
    backgroundColor: theme.surfaceRaised,
  });
  const shortcuts = new TextRenderable(renderer, {
    id: "herdr-shortcuts",
    flexGrow: 1,
    height: 1,
    content: "",
  });
  const status = new TextRenderable(renderer, {
    id: "herdr-status",
    height: 1,
    content: "",
  });
  footer.add(shortcuts);
  footer.add(status);

  root.add(header);
  root.add(main);
  root.add(footer);
  renderer.root.add(root);

  const selectedCategory = (): HerdrSettingCategory =>
    HERDR_SETTING_CATEGORIES[selectedCategoryIndex] ?? HERDR_SETTING_CATEGORIES[0]!;

  const selectedDefinition = (): HerdrSettingDefinition =>
    (settingList.getSelectedOption()?.value as HerdrSettingDefinition | undefined) ??
    selectedCategory().settings[0]!;

  const isDirty = (): boolean => buildHerdrConfig(snapshot.source, values) !== snapshot.source;

  const setStatus = (message: string, tone: StatusTone = "normal"): void => {
    status.content = new StyledText([fg(statusColor(tone))(message)]);
  };

  const refreshSummary = (): void => {
    const warnings = herdrConfigWarnings(values).length + snapshot.issues.length;
    summary.content = new StyledText([
      fg(isDirty() ? theme.warning : theme.success)(isDirty() ? "● unsaved" : "✓ saved"),
      ...(warnings > 0 ? [fg(theme.border)("  "), fg(theme.warning)(`${warnings} warning`)] : []),
    ]);
  };

  const refreshSettingDetail = (): void => {
    const definition = selectedDefinition();
    detail.content = settingDetail(definition, snapshot, values);
    if (renderer.currentFocusedRenderable !== valueInput) {
      valueInput.value = values[definition.path] ?? definition.defaultValue;
    }
    refreshSummary();
  };

  const refreshCategorySelection = (): void => {
    for (const [index, { tile }] of categoryTiles.entries()) {
      const selected = index === selectedCategoryIndex;
      tile.borderStyle = selected ? "double" : "single";
      tile.borderColor = selected ? theme.borderFocused : theme.border;
      tile.backgroundColor = selected ? theme.surfaceRaised : theme.surface;
    }
    if (view === "categories") {
      detail.content = categoryDetail(selectedCategory());
      refreshSummary();
    }
  };

  const refreshFooter = (): void => {
    if (reloadPrompt) {
      shortcuts.content = new StyledText([
        fg(theme.text)(" y "),
        fg(theme.textMuted)("reload now  "),
        fg(theme.text)(" n/Esc "),
        fg(theme.textMuted)("skip"),
      ]);
      return;
    }

    shortcuts.content = view === "categories"
      ? new StyledText([
        fg(theme.text)(" ⛖ "),
        fg(theme.textMuted)("navigate  "),
        fg(theme.text)(" enter "),
        fg(theme.textMuted)("open  "),
        fg(theme.text)(" s "),
        fg(theme.textMuted)("save  "),
        fg(theme.text)(" r "),
        fg(theme.textMuted)("reload  "),
        fg(theme.text)(" p "),
        fg(theme.textMuted)("path  "),
        ...(options.onBack ? [fg(theme.text)(" Esc/b "), fg(theme.textMuted)("back  ")] : []),
        fg(theme.text)(" q "),
        fg(theme.textMuted)("quit"),
      ])
      : new StyledText([
        fg(theme.text)(" ↑↓ "),
        fg(theme.textMuted)("select  "),
        fg(theme.text)(" ←→ "),
        fg(theme.textMuted)("adjust  "),
        fg(theme.text)(" enter "),
        fg(theme.textMuted)("edit  "),
        fg(theme.text)(" x "),
        fg(theme.textMuted)("reset  "),
        fg(theme.text)(" Esc/b "),
        fg(theme.textMuted)("categories  "),
        fg(theme.text)(" s "),
        fg(theme.textMuted)("save  "),
        fg(theme.text)(" q "),
        fg(theme.textMuted)("quit"),
      ]);
  };

  const refreshPathInput = (): void => {
    if (renderer.currentFocusedRenderable !== configPathInput) {
      configPathInput.value = snapshot.path;
    }
  };

  const targetSettingsPanelWidth = (): number =>
    renderer.terminalWidth >= WIDE_LAYOUT_MIN_WIDTH
      ? Math.round(renderer.terminalWidth * SETTINGS_PANEL_RATIO)
      : renderer.terminalWidth;

  const refreshRows = (): void => {
    const selectedKey = selectedDefinition().path;
    const settings = selectedCategory().settings;
    // Percentage widths are not resolved during the initial layout pass. Derive
    // the row width from the terminal so the first frame is never formatted at
    // the narrow fallback width.
    const availableWidth = Math.max(28, targetSettingsPanelWidth() - 5);
    settingList.options = settings.map((definition) => ({
      name: settingRow(definition, values[definition.path] ?? definition.defaultValue, availableWidth),
      description: "",
      value: definition,
    }));
    const index = settings.findIndex((definition) => definition.path === selectedKey);
    settingList.setSelectedIndex(Math.max(0, index));
    refreshPathInput();
    refreshSettingDetail();
  };

  let categoryLayoutRows: number[][] = [];
  const updateCategoryGrid = (): void => {
    const compact = renderer.terminalWidth < WIDE_LAYOUT_MIN_WIDTH;
    const tileWidth = compact ? CATEGORY_COMPACT_TILE_WIDTH : CATEGORY_TILE_WIDTH;
    const tileHeight = compact ? CATEGORY_COMPACT_TILE_HEIGHT : CATEGORY_TILE_HEIGHT;
    const availableWidth = Math.max(
      tileWidth,
      targetSettingsPanelWidth() - 2 - CATEGORY_GRID_PADDING_X * 2,
    );
    const columns = Math.max(
      1,
      Math.floor((availableWidth + CATEGORY_TILE_GAP) / (tileWidth + CATEGORY_TILE_GAP)),
    );

    categoryLayoutRows = [];
    for (let index = 0; index < HERDR_SETTING_CATEGORIES.length; index += columns) {
      categoryLayoutRows.push(
        HERDR_SETTING_CATEGORIES.slice(index, index + columns).map((_, offset) => index + offset),
      );
    }
    categoryGrid.paddingY = compact ? 0 : 1;
    categoryGrid.rowGap = compact ? 0 : CATEGORY_TILE_GAP;
    for (const [index, { tile, thumbnail }] of categoryTiles.entries()) {
      tile.width = tileWidth;
      tile.height = tileHeight;
      thumbnail.height = compact ? 1 : 2;
      thumbnail.content = categoryTile(HERDR_SETTING_CATEGORIES[index]!, tileWidth, compact);
    }
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
    const settingsWidth = targetSettingsPanelWidth();
    settingsPanel.width = wide ? settingsWidth : "100%";
    settingsPanel.height = wide ? "100%" : view === "categories" ? "72%" : "55%";
    detailPanel.width = wide ? renderer.terminalWidth - settingsWidth : "100%";
    detailPanel.height = wide ? "100%" : view === "categories" ? "28%" : "45%";
    updateCategoryGrid();
    if (view === "settings") refreshRows();
    else {
      refreshPathInput();
      refreshCategorySelection();
    }
    refreshFooter();
  };

  const focusCurrentView = (): void => {
    if (view === "settings") settingList.focus();
    else root.focus();
  };

  const showCategorySettings = (group: HerdrSettingGroup): void => {
    const index = HERDR_SETTING_CATEGORIES.findIndex((category) => category.group === group);
    if (index < 0) return;
    selectedCategoryIndex = index;
    view = "settings";
    categoryGrid.visible = false;
    settingList.visible = true;
    editorLabel.visible = true;
    valueInput.visible = true;
    settingsPanel.title = ` ${selectedCategory().group.toUpperCase()} · ${selectedCategory().settings.length} `;
    detailPanel.title = " CONFIGURE ";
    updateLayout();
    focusCurrentView();
    setStatus(`${selectedCategory().group} settings`, "normal");
  };

  const showCategories = (): void => {
    view = "categories";
    categoryGrid.visible = true;
    settingList.visible = false;
    editorLabel.visible = false;
    valueInput.visible = false;
    settingsPanel.title = ` CATEGORIES · ${HERDR_SETTING_CATEGORIES.length} `;
    detailPanel.title = " CATEGORY ";
    updateLayout();
    focusCurrentView();
    setStatus(`${selectedCategory().group} · ${selectedCategory().settings.length} settings`, "normal");
  };

  const selectCategoryIndex = (nextIndex: number): void => {
    if (!HERDR_SETTING_CATEGORIES[nextIndex] || nextIndex === selectedCategoryIndex) return;
    selectedCategoryIndex = nextIndex;
    refreshCategorySelection();
    setStatus(`${selectedCategory().group} · ${selectedCategory().settings.length} settings`, "normal");
  };

  const moveCategoryHorizontal = (direction: -1 | 1): void => {
    selectCategoryIndex(
      Math.max(0, Math.min(HERDR_SETTING_CATEGORIES.length - 1, selectedCategoryIndex + direction)),
    );
  };

  const moveCategoryVertical = (direction: -1 | 1): void => {
    const rowIndex = categoryLayoutRows.findIndex((row) => row.includes(selectedCategoryIndex));
    if (rowIndex < 0) return;
    const nextRow = categoryLayoutRows[rowIndex + direction];
    if (!nextRow) return;
    const column = categoryLayoutRows[rowIndex]!.indexOf(selectedCategoryIndex);
    selectCategoryIndex(nextRow[Math.min(column, nextRow.length - 1)]!);
  };

  const adjust = (direction: -1 | 1): void => {
    const definition = selectedDefinition();
    if (definition.kind === "text") {
      setStatus("Press Enter to edit this value", "normal");
      return;
    }
    discardArmed = false;
    values[definition.path] = adjustHerdrValue(definition, values[definition.path]!, direction);
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
    setStatus("Editing Herdr config path · Enter loads · Esc cancels", "normal");
  };

  const resetSelected = (): void => {
    const definition = selectedDefinition();
    discardArmed = false;
    values[definition.path] = snapshot.values[definition.path] ?? definition.defaultValue;
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
      focusCurrentView();
      setStatus("Config path unchanged", "normal");
      return;
    }

    if (isDirty()) {
      configPathInput.value = snapshot.path;
      focusCurrentView();
      setStatus("Save or reset changes before changing the config path", "warning");
      return;
    }

    saving = true;
    setStatus("Loading config path…", "warning");
    try {
      snapshot = await loadHerdrConfig(nextPath);
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      if (view === "settings") refreshRows();
      else {
        refreshPathInput();
        refreshCategorySelection();
      }
      focusCurrentView();
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
      const result = await (options.onSave ?? saveHerdrConfig)(snapshot, values);
      snapshot = result;
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      if (view === "settings") refreshRows();
      else refreshCategorySelection();
      reloadPrompt = true;
      refreshFooter();
      setStatus(
        result.backupPath
          ? "Saved · backup updated · reload Herdr config now?"
          : "Saved · reload Herdr config now?",
        "warning",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    } finally {
      saving = false;
    }
  };

  const applyConfig = async (): Promise<void> => {
    if (saving) return;
    reloadPrompt = false;
    refreshFooter();
    saving = true;
    setStatus("Running herdr server reload-config…", "warning");
    try {
      await (options.onApplyConfig ?? reloadHerdrServerConfig)();
      if (disposed) return;
      setStatus("Herdr config reloaded", "success");
    } catch (error) {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Saved · reload failed: ${message}`, "error");
    } finally {
      saving = false;
    }
  };

  const reload = async (): Promise<void> => {
    if (saving) return;
    saving = true;
    setStatus("Reloading from disk…", "warning");
    try {
      snapshot = await (options.onReload ?? (() => loadHerdrConfig(snapshot.path)))();
      values = { ...snapshot.values };
      discardArmed = false;
      if (disposed) return;
      if (view === "settings") refreshRows();
      else refreshCategorySelection();
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
        focusCurrentView();
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
    if (reloadPrompt) {
      if (key.name === "y") {
        consume(key);
        void applyConfig();
        return;
      }
      if (key.name === "n" || key.name === "escape") {
        consume(key);
        reloadPrompt = false;
        refreshFooter();
        setStatus("Saved · reload skipped", "normal");
        return;
      }
      if (key.name === "q") {
        reloadPrompt = false;
        refreshFooter();
      } else {
        consume(key);
        return;
      }
    }
    if (key.name === "q") {
      consume(key);
      if (canDiscard()) options.onQuit?.();
      return;
    }
    if ((view === "settings" || options.onBack) && (key.name === "escape" || key.name === "b")) {
      consume(key);
      if (view === "settings") showCategories();
      else if (canDiscard()) options.onBack?.();
      return;
    }

    if (view === "categories") {
      if (key.name === "left" || key.name === "h") {
        moveCategoryHorizontal(-1);
      } else if (key.name === "right" || key.name === "l") {
        moveCategoryHorizontal(1);
      } else if (key.name === "up" || key.name === "k") {
        moveCategoryVertical(-1);
      } else if (key.name === "down" || key.name === "j") {
        moveCategoryVertical(1);
      } else if (key.name === "return" || key.name === "enter" || key.sequence === "\r") {
        showCategorySettings(selectedCategory().group);
      } else if (key.name === "s") {
        void save();
      } else if (key.name === "r") {
        void reload();
      } else if (key.name === "p") {
        editPath();
      } else {
        return;
      }
      consume(key);
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

  const selectionHandler = (): void => {
    if (view === "settings") refreshSettingDetail();
  };
  const inputSubmitHandler = (): void => {
    const definition = selectedDefinition();
    try {
      values[definition.path] = validateHerdrValue(definition, valueInput.value);
      discardArmed = false;
      ignoreSubmittedEnter = true;
      queueMicrotask(() => {
        ignoreSubmittedEnter = false;
      });
      focusCurrentView();
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
  focusCurrentView();
  setStatus(snapshot.exists ? "Ready" : "New config · save to create it", "normal");

  return {
    root,
    settingList,
    configPathInput,
    valueInput,
    get values() {
      return values;
    },
    get view() {
      return view;
    },
    get selectedCategory() {
      return selectedCategory();
    },
    openCategory(group) {
      showCategorySettings(group);
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
