import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type HerdrSettingGroup =
  | "General"
  | "Theme"
  | "Terminal"
  | "Updates"
  | "Keys"
  | "UI"
  | "Toast"
  | "Sound"
  | "Session"
  | "Worktrees"
  | "Remote"
  | "Advanced"
  | "Labs";
export type HerdrSettingKind = "text" | "number" | "choice";
export type HerdrLiteralKind = "string" | "number" | "boolean";

export interface HerdrSettingDefinition {
  path: string;
  key: string;
  tablePath: string[];
  label: string;
  group: HerdrSettingGroup;
  kind: HerdrSettingKind;
  literalKind: HerdrLiteralKind;
  defaultValue: string;
  description: string;
  allowEmpty?: boolean;
  allowArray?: boolean;
  removeWhenEmpty?: boolean;
  choices?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
}

export interface HerdrConfigIssue {
  line: number;
  key: string;
  message: string;
}

export interface HerdrConfigSnapshot {
  path: string;
  exists: boolean;
  source: string;
  values: Record<string, string>;
  configuredValues: Record<string, string>;
  issues: HerdrConfigIssue[];
}

export interface HerdrConfigSaveResult extends HerdrConfigSnapshot {
  backupPath?: string;
}

const booleanChoices = ["false", "true"] as const;

export const HERDR_SETTINGS: readonly HerdrSettingDefinition[] = [
  {
    path: "onboarding",
    key: "onboarding",
    tablePath: [],
    label: "Onboarding",
    group: "General",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Show first-run setup when Herdr starts.",
    choices: booleanChoices,
  },
  {
    path: "theme.name",
    key: "name",
    tablePath: ["theme"],
    label: "Theme",
    group: "Theme",
    kind: "text",
    literalKind: "string",
    defaultValue: "catppuccin",
    description: "Built-in Herdr theme name, such as catppuccin, terminal, nord, or tokyo-night.",
  },
  {
    path: "theme.auto_switch",
    key: "auto_switch",
    tablePath: ["theme"],
    label: "Auto switch",
    group: "Theme",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "false",
    description: "Follow the host terminal's light or dark appearance.",
    choices: booleanChoices,
  },
  {
    path: "theme.dark_name",
    key: "dark_name",
    tablePath: ["theme"],
    label: "Dark theme",
    group: "Theme",
    kind: "text",
    literalKind: "string",
    defaultValue: "",
    allowEmpty: true,
    removeWhenEmpty: true,
    description: "Theme used for dark appearance. Empty lets Herdr infer a sibling theme.",
  },
  {
    path: "theme.light_name",
    key: "light_name",
    tablePath: ["theme"],
    label: "Light theme",
    group: "Theme",
    kind: "text",
    literalKind: "string",
    defaultValue: "",
    allowEmpty: true,
    removeWhenEmpty: true,
    description: "Theme used for light appearance. Empty lets Herdr infer a sibling theme.",
  },
  {
    path: "terminal.default_shell",
    key: "default_shell",
    tablePath: ["terminal"],
    label: "Default shell",
    group: "Terminal",
    kind: "text",
    literalKind: "string",
    defaultValue: "",
    allowEmpty: true,
    description: "Executable for new interactive panes. Empty uses SHELL, then /bin/sh.",
  },
  {
    path: "terminal.shell_mode",
    key: "shell_mode",
    tablePath: ["terminal"],
    label: "Shell mode",
    group: "Terminal",
    kind: "choice",
    literalKind: "string",
    defaultValue: "auto",
    description: "Start new panes with automatic, login, or non-login shells.",
    choices: ["auto", "login", "non_login"],
  },
  {
    path: "terminal.new_cwd",
    key: "new_cwd",
    tablePath: ["terminal"],
    label: "New pane CWD",
    group: "Terminal",
    kind: "text",
    literalKind: "string",
    defaultValue: "follow",
    description: "Use follow, home, current, or a fixed path for new panes and workspaces.",
  },
  {
    path: "update.channel",
    key: "channel",
    tablePath: ["update"],
    label: "Update channel",
    group: "Updates",
    kind: "choice",
    literalKind: "string",
    defaultValue: process.platform === "win32" ? "preview" : "stable",
    description: "Choose stable or preview Herdr releases.",
    choices: ["stable", "preview"],
  },
  {
    path: "update.version_check",
    key: "version_check",
    tablePath: ["update"],
    label: "Version checks",
    group: "Updates",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Check herdr.dev for new Herdr versions in the background.",
    choices: booleanChoices,
  },
  {
    path: "update.manifest_check",
    key: "manifest_check",
    tablePath: ["update"],
    label: "Manifest checks",
    group: "Updates",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Check for remote agent-detection manifest updates.",
    choices: booleanChoices,
  },
  {
    path: "keys.prefix",
    key: "prefix",
    tablePath: ["keys"],
    label: "Prefix",
    group: "Keys",
    kind: "text",
    literalKind: "string",
    defaultValue: "ctrl+b",
    description: "Prefix key used to enter command mode.",
  },
  ...([
    ["help", "Help", "prefix+?", "Open keybinding help."],
    ["settings", "Settings", "prefix+s", "Open Herdr settings."],
    ["detach", "Detach", "prefix+q", "Detach from the persistent session."],
    ["reload_config", "Reload config", "prefix+shift+r", "Reload Herdr configuration."],
    ["open_notification_target", "Open notification", "prefix+o", "Focus the visible notification target."],
    ["workspace_picker", "Workspace picker", "prefix+w", "Open workspace navigation."],
    ["goto", "Go to", "prefix+g", "Open the session navigator."],
    ["new_workspace", "New workspace", "prefix+shift+n", "Create a new workspace."],
    ["new_worktree", "New worktree", "prefix+shift+g", "Create a Git worktree from the selected workspace."],
    ["open_worktree", "Open worktree", "", "Open an existing Git worktree."],
    ["remove_worktree", "Remove worktree", "", "Delete the selected managed worktree after confirmation."],
    ["rename_workspace", "Rename workspace", "prefix+shift+w", "Rename the selected workspace."],
    ["close_workspace", "Close workspace", "prefix+shift+d", "Close the selected workspace."],
    ["previous_workspace", "Previous workspace", "", "Select the previous workspace."],
    ["next_workspace", "Next workspace", "", "Select the next workspace."],
    ["previous_agent", "Previous agent", "", "Focus the previous agent in the sidebar."],
    ["next_agent", "Next agent", "", "Focus the next agent in the sidebar."],
    ["focus_agent", "Focus agent", "", "Focus an agent with an indexed 1–9 binding."],
    ["remote_image_paste", "Remote image paste", "ctrl+v", "Paste a clipboard image into a remote session."],
    ["new_tab", "New tab", "prefix+c", "Create a tab in the active workspace."],
    ["rename_tab", "Rename tab", "prefix+shift+t", "Rename the active tab."],
    ["previous_tab", "Previous tab", "prefix+p", "Select the previous tab."],
    ["next_tab", "Next tab", "prefix+n", "Select the next tab."],
    ["switch_tab", "Switch tab", "prefix+1..9", "Switch to tab 1–9."],
    ["switch_workspace", "Switch workspace", "", "Switch to workspace 1–9."],
    ["close_tab", "Close tab", "prefix+shift+x", "Close the active tab."],
    ["rename_pane", "Rename pane", "prefix+shift+p", "Rename the focused pane."],
    ["edit_scrollback", "Edit scrollback", "prefix+e", "Open focused-pane scrollback in EDITOR."],
    ["copy_mode", "Copy mode", "prefix+[", "Enter keyboard copy mode."],
    ["focus_pane_left", "Focus left", "prefix+h", "Focus the pane to the left."],
    ["focus_pane_down", "Focus down", "prefix+j", "Focus the pane below."],
    ["focus_pane_up", "Focus up", "prefix+k", "Focus the pane above."],
    ["focus_pane_right", "Focus right", "prefix+l", "Focus the pane to the right."],
    ["swap_pane_left", "Swap left", "prefix+shift+h", "Swap the focused pane to the left."],
    ["swap_pane_down", "Swap down", "prefix+shift+j", "Swap the focused pane downward."],
    ["swap_pane_up", "Swap up", "prefix+shift+k", "Swap the focused pane upward."],
    ["swap_pane_right", "Swap right", "prefix+shift+l", "Swap the focused pane to the right."],
    ["cycle_pane_next", "Cycle next pane", "prefix+tab", "Cycle to the next pane."],
    ["cycle_pane_previous", "Cycle previous pane", "prefix+shift+tab", "Cycle to the previous pane."],
    ["last_pane", "Last pane", "", "Focus the last focused pane across the session."],
    ["split_vertical", "Vertical split", "prefix+v", "Split the focused pane side by side."],
    ["split_horizontal", "Horizontal split", "prefix+minus", "Split the focused pane into stacked panes."],
    ["close_pane", "Close pane", "prefix+x", "Close the focused pane."],
    ["zoom", "Zoom pane", "prefix+z", "Toggle zoom for the focused pane."],
    ["resize_mode", "Resize mode", "prefix+r", "Enter pane resize mode."],
    ["toggle_sidebar", "Toggle sidebar", "prefix+b", "Collapse or expand the sidebar."],
    ["navigate_workspace_up", "Navigate workspace up", "up", "Move workspace selection up in navigate mode."],
    ["navigate_workspace_down", "Navigate workspace down", "down", "Move workspace selection down in navigate mode."],
    ["navigate_pane_left", "Navigate pane left", "h", "Focus the pane to the left in navigate mode."],
    ["navigate_pane_down", "Navigate pane down", "j", "Focus the pane below in navigate mode."],
    ["navigate_pane_up", "Navigate pane up", "k", "Focus the pane above in navigate mode."],
    ["navigate_pane_right", "Navigate pane right", "l", "Focus the pane to the right in navigate mode."],
  ] as const).map(([key, label, defaultValue, description]) => ({
    path: `keys.${key}`,
    key,
    tablePath: ["keys"],
    label,
    group: "Keys" as const,
    kind: "text" as const,
    literalKind: "string" as const,
    defaultValue,
    allowEmpty: true,
    allowArray: key !== "remote_image_paste",
    description,
  })),
  ...([
    ["tabs", "Indexed tabs", "", "Legacy modifier combination for direct tab shortcuts 1–9."],
    ["workspaces", "Indexed workspaces", "", "Legacy modifier combination for workspace shortcuts 1–9."],
    ["agents", "Indexed agents", "", "Legacy modifier combination for agent shortcuts 1–9."],
  ] as const).map(([key, label, defaultValue, description]) => ({
    path: `keys.indexed.${key}`,
    key,
    tablePath: ["keys", "indexed"],
    label,
    group: "Keys" as const,
    kind: "text" as const,
    literalKind: "string" as const,
    defaultValue,
    allowEmpty: true,
    description,
  })),
  {
    path: "ui.sidebar_width",
    key: "sidebar_width",
    tablePath: ["ui"],
    label: "Sidebar width",
    group: "UI",
    kind: "number",
    literalKind: "number",
    defaultValue: "26",
    description: "Default expanded sidebar width in terminal columns.",
    min: 1,
    max: 300,
    step: 1,
    decimals: 0,
  },
  {
    path: "ui.sidebar_min_width",
    key: "sidebar_min_width",
    tablePath: ["ui"],
    label: "Sidebar minimum",
    group: "UI",
    kind: "number",
    literalKind: "number",
    defaultValue: "18",
    description: "Minimum expanded sidebar width in columns.",
    min: 1,
    max: 300,
    step: 1,
    decimals: 0,
  },
  {
    path: "ui.sidebar_max_width",
    key: "sidebar_max_width",
    tablePath: ["ui"],
    label: "Sidebar maximum",
    group: "UI",
    kind: "number",
    literalKind: "number",
    defaultValue: "36",
    description: "Maximum expanded sidebar width in columns.",
    min: 1,
    max: 300,
    step: 1,
    decimals: 0,
  },
  {
    path: "ui.sidebar_start_collapsed",
    key: "sidebar_start_collapsed",
    tablePath: ["ui"],
    label: "Start collapsed",
    group: "UI",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "false",
    description: "Start Herdr with the sidebar collapsed.",
    choices: booleanChoices,
  },
  {
    path: "ui.sidebar_collapsed_mode",
    key: "sidebar_collapsed_mode",
    tablePath: ["ui"],
    label: "Collapsed mode",
    group: "UI",
    kind: "choice",
    literalKind: "string",
    defaultValue: "compact",
    description: "Keep a compact status rail or hide the collapsed sidebar.",
    choices: ["compact", "hidden"],
  },
  {
    path: "ui.mobile_width_threshold",
    key: "mobile_width_threshold",
    tablePath: ["ui"],
    label: "Mobile threshold",
    group: "UI",
    kind: "number",
    literalKind: "number",
    defaultValue: "64",
    description: "Terminal width that activates the mobile single-column layout.",
    min: 20,
    max: 500,
    step: 1,
    decimals: 0,
  },
  ...([
    ["mouse_capture", "Mouse capture", "true", "Capture mouse input for Herdr's mouse UI."],
    ["copy_on_select", "Copy on select", "true", "Copy text selected by mouse drag."],
    ["redraw_on_focus_gained", "Redraw on focus", "true", "Force a full redraw when the terminal regains focus."],
    ["confirm_close", "Confirm close", "true", "Ask before closing a workspace."],
    ["prompt_new_tab_name", "Prompt tab name", "true", "Ask for a name before creating a tab."],
    ["prompt_new_workspace_name", "Prompt workspace", "false", "Ask for a name before creating a workspace."],
    ["pane_borders", "Pane borders", "true", "Draw borders around split panes."],
    ["pane_gaps", "Pane gaps", "true", "Keep split panes visually separated."],
    ["show_agent_labels_on_pane_borders", "Agent labels", "false", "Show detected agent labels in pane borders."],
    ["hide_tab_bar_when_single_tab", "Hide single tab", "false", "Hide the tab row when a workspace has one tab."],
  ] as const).map(([key, label, defaultValue, description]) => ({
    path: `ui.${key}`,
    key,
    tablePath: ["ui"],
    label,
    group: "UI" as const,
    kind: "choice" as const,
    literalKind: "boolean" as const,
    defaultValue,
    description,
    choices: booleanChoices,
  })),
  {
    path: "ui.host_cursor",
    key: "host_cursor",
    tablePath: ["ui"],
    label: "Host cursor",
    group: "UI",
    kind: "choice",
    literalKind: "string",
    defaultValue: "auto",
    description: "Choose automatic, native terminal, or Herdr-drawn cursor rendering.",
    choices: ["auto", "native", "drawn"],
  },
  {
    path: "ui.mouse_scroll_lines",
    key: "mouse_scroll_lines",
    tablePath: ["ui"],
    label: "Mouse scroll",
    group: "UI",
    kind: "number",
    literalKind: "number",
    defaultValue: "3",
    description: "Pane scrollback lines moved per mouse-wheel notch.",
    min: 1,
    max: 100,
    step: 1,
    decimals: 0,
  },
  {
    path: "ui.agent_panel_sort",
    key: "agent_panel_sort",
    tablePath: ["ui"],
    label: "Agent ordering",
    group: "UI",
    kind: "choice",
    literalKind: "string",
    defaultValue: "spaces",
    description: "Group agents by space or order them as an attention queue.",
    choices: ["spaces", "priority"],
  },
  {
    path: "ui.accent",
    key: "accent",
    tablePath: ["ui"],
    label: "Accent",
    group: "UI",
    kind: "text",
    literalKind: "string",
    defaultValue: "cyan",
    description: "Accent color as a name, hex color, or rgb(r,g,b).",
  },
  {
    path: "ui.toast.delivery",
    key: "delivery",
    tablePath: ["ui", "toast"],
    label: "Delivery",
    group: "Toast",
    kind: "choice",
    literalKind: "string",
    defaultValue: "off",
    description: "Send notifications in Herdr, through the terminal, through the OS, or not at all.",
    choices: ["off", "herdr", "terminal", "system"],
  },
  {
    path: "ui.toast.delay_seconds",
    key: "delay_seconds",
    tablePath: ["ui", "toast"],
    label: "Delay",
    group: "Toast",
    kind: "number",
    literalKind: "number",
    defaultValue: "1",
    description: "Seconds to wait before sending agent-state notifications.",
    min: 0,
    max: 3600,
    step: 1,
    decimals: 0,
  },
  {
    path: "ui.toast.herdr.position",
    key: "position",
    tablePath: ["ui", "toast", "herdr"],
    label: "Toast position",
    group: "Toast",
    kind: "choice",
    literalKind: "string",
    defaultValue: "bottom-right",
    description: "Position of in-app Herdr notifications.",
    choices: ["top-left", "top-right", "bottom-left", "bottom-right"],
  },
  {
    path: "ui.toast.clipboard.enabled",
    key: "enabled",
    tablePath: ["ui", "toast", "clipboard"],
    label: "Clipboard toast",
    group: "Toast",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Show a popup after copying a mouse selection.",
    choices: booleanChoices,
  },
  {
    path: "ui.toast.clipboard.position",
    key: "position",
    tablePath: ["ui", "toast", "clipboard"],
    label: "Clipboard position",
    group: "Toast",
    kind: "choice",
    literalKind: "string",
    defaultValue: "bottom-center",
    description: "Position of copied-to-clipboard notifications.",
    choices: ["top-left", "top-center", "top-right", "bottom-left", "bottom-center", "bottom-right"],
  },
  {
    path: "ui.sound.enabled",
    key: "enabled",
    tablePath: ["ui", "sound"],
    label: "Sound enabled",
    group: "Sound",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Play sounds for agent state changes in background workspaces.",
    choices: booleanChoices,
  },
  ...([
    ["path", "All sounds", "Optional mp3 file used for every sound notification."],
    ["done_path", "Done sound", "Optional mp3 file for finished-agent notifications."],
    ["request_path", "Request sound", "Optional mp3 file for needs-input notifications."],
  ] as const).map(([key, label, description]) => ({
    path: `ui.sound.${key}`,
    key,
    tablePath: ["ui", "sound"],
    label,
    group: "Sound" as const,
    kind: "text" as const,
    literalKind: "string" as const,
    defaultValue: "",
    allowEmpty: true,
    removeWhenEmpty: true,
    description,
  })),
  {
    path: "session.resume_agents_on_restore",
    key: "resume_agents_on_restore",
    tablePath: ["session"],
    label: "Resume agents",
    group: "Session",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Resume supported agent conversations after a Herdr server restart.",
    choices: booleanChoices,
  },
  {
    path: "worktrees.directory",
    key: "directory",
    tablePath: ["worktrees"],
    label: "Worktree directory",
    group: "Worktrees",
    kind: "text",
    literalKind: "string",
    defaultValue: "~/.herdr/worktrees",
    description: "Root directory for Git worktree checkouts created by Herdr.",
  },
  {
    path: "remote.manage_ssh_config",
    key: "manage_ssh_config",
    tablePath: ["remote"],
    label: "Manage SSH",
    group: "Remote",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Add keepalive fallbacks and private connection reuse for remote attach.",
    choices: booleanChoices,
  },
  {
    path: "advanced.scrollback_limit_bytes",
    key: "scrollback_limit_bytes",
    tablePath: ["advanced"],
    label: "Scrollback bytes",
    group: "Advanced",
    kind: "number",
    literalKind: "number",
    defaultValue: "10000000",
    description: "Maximum scrollback buffer retained per pane terminal.",
    min: 0,
    max: 1_000_000_000,
    step: 1_000_000,
    decimals: 0,
  },
  ...([
    ["allow_nested", "Allow nested", "Allow launching Herdr inside a Herdr-managed pane."],
    ["kitty_graphics", "Kitty graphics", "Enable experimental local Kitty graphics rendering."],
    ["pane_history", "Pane history", "Persist recent pane screen history across server restarts."],
    [
      "reveal_hidden_cursor_for_cjk_ime",
      "Reveal IME cursor",
      "Expose a cursor anchor so macOS input methods track agent TUIs.",
    ],
    [
      "switch_ascii_input_source_in_prefix",
      "ASCII prefix input",
      "Temporarily use an ASCII input source while prefix commands are active on macOS.",
    ],
  ] as const).map(([key, label, description]) => ({
    path: `experimental.${key}`,
    key,
    tablePath: ["experimental"],
    label,
    group: "Labs" as const,
    kind: "choice" as const,
    literalKind: "boolean" as const,
    defaultValue: "false",
    description,
    choices: booleanChoices,
  })),
  {
    path: "experimental.cjk_ime_cursor_shape",
    key: "cjk_ime_cursor_shape",
    tablePath: ["experimental"],
    label: "IME cursor shape",
    group: "Labs",
    kind: "choice",
    literalKind: "string",
    defaultValue: "steady_block",
    description: "Cursor shape rendered for the macOS input-method anchor.",
    choices: ["block", "steady_block", "underline", "steady_underline", "bar", "steady_bar"],
  },
] as const;

const definitionsByPath = new Map(HERDR_SETTINGS.map((setting) => [setting.path, setting]));

function defaultValues(): Record<string, string> {
  return Object.fromEntries(HERDR_SETTINGS.map((setting) => [setting.path, setting.defaultValue]));
}

function normalizePath(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join(".");
}

function parseTableHeader(line: string): string[] | undefined {
  const match = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/.exec(line);
  return match ? match[1]!.split(".").map((part) => part.trim()).filter(Boolean) : undefined;
}

function splitValueAndComment(raw: string): { value: string; comment: string } {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") {
      let commentStart = index;
      while (commentStart > 0 && /\s/.test(raw[commentStart - 1]!)) commentStart -= 1;
      return { value: raw.slice(0, commentStart).trim(), comment: raw.slice(commentStart) };
    }
  }
  return { value: raw.trim(), comment: "" };
}

function unquoteTomlValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

interface Assignment {
  path: string;
  prefix: string;
  value: string;
  comment: string;
}

function parseAssignment(line: string, tablePath: string[]): Assignment | undefined {
  const match = /^(\s*[A-Za-z][\w-]*(?:\s*\.\s*[A-Za-z][\w-]*)*\s*=\s*)(.*)$/.exec(line);
  if (!match) return undefined;
  const keyExpression = match[1]!.slice(0, match[1]!.lastIndexOf("=")).trim();
  const keyParts = keyExpression.split(".").map((part) => part.trim());
  const { value, comment } = splitValueAndComment(match[2]!);
  return {
    path: normalizePath([...tablePath, ...keyParts]),
    prefix: match[1]!,
    value,
    comment,
  };
}

function parseHerdrAssignments(source: string): {
  values: Record<string, string>;
  configuredValues: Record<string, string>;
} {
  const values = defaultValues();
  const configuredValues: Record<string, string> = {};
  let tablePath: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const header = parseTableHeader(line);
    if (header) {
      tablePath = header;
      continue;
    }
    const assignment = parseAssignment(line, tablePath);
    if (!assignment || !definitionsByPath.has(assignment.path)) continue;
    const value = unquoteTomlValue(assignment.value);
    values[assignment.path] = value;
    configuredValues[assignment.path] = value;
  }

  return { values, configuredValues };
}

export function findHerdrConfigIssues(source: string): HerdrConfigIssue[] {
  const issues: HerdrConfigIssue[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    if (/^[A-Za-z][\w.-]*$/.test(trimmed)) {
      issues.push({
        line: index + 1,
        key: trimmed,
        message: `Line ${index + 1}: ${trimmed} has no value and Herdr will ignore it.`,
      });
    }
  }
  return issues;
}

export function parseHerdrConfig(pathname: string, source: string, exists = true): HerdrConfigSnapshot {
  const { values, configuredValues } = parseHerdrAssignments(source);
  return {
    path: pathname,
    exists,
    source,
    values,
    configuredValues,
    issues: findHerdrConfigIssues(source),
  };
}

export function defaultHerdrConfigPath(): string {
  if (process.env.HERDR_CONFIG_PATH) return path.resolve(process.env.HERDR_CONFIG_PATH);
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "herdr", "config.toml");
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configRoot = xdgConfigHome ? path.resolve(xdgConfigHome) : path.join(os.homedir(), ".config");
  return path.join(configRoot, "herdr", "config.toml");
}

export async function loadHerdrConfig(configPath = defaultHerdrConfigPath()): Promise<HerdrConfigSnapshot> {
  try {
    const source = await readFile(configPath, "utf8");
    return parseHerdrConfig(configPath, source, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseHerdrConfig(configPath, "", false);
    throw error;
  }
}

export function validateHerdrValue(definition: HerdrSettingDefinition, rawValue: string): string {
  const value = rawValue.trim();
  if (!value && !definition.allowEmpty) throw new Error(`${definition.label} cannot be empty.`);
  if (/\r|\n/.test(value)) throw new Error(`${definition.label} must fit on one line.`);

  if (definition.kind === "choice") {
    if (!definition.choices?.includes(value)) {
      throw new Error(`${definition.label} must be one of: ${definition.choices?.join(", ")}.`);
    }
    return value;
  }
  if (definition.kind === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${definition.label} must be a number.`);
    if (definition.decimals === 0 && !Number.isInteger(number)) {
      throw new Error(`${definition.label} must be a whole number.`);
    }
    if (definition.min !== undefined && number < definition.min) {
      throw new Error(`${definition.label} must be at least ${definition.min}.`);
    }
    if (definition.max !== undefined && number > definition.max) {
      throw new Error(`${definition.label} must be at most ${definition.max}.`);
    }
    return number.toFixed(definition.decimals ?? 0);
  }
  return value;
}

function formatLiteral(definition: HerdrSettingDefinition, value: string): string {
  const validated = validateHerdrValue(definition, value);
  if (definition.allowArray && validated.startsWith("[")) {
    let shortcuts: unknown;
    try {
      shortcuts = JSON.parse(validated);
    } catch {
      throw new Error(`${definition.label} shortcut arrays must use quoted strings, for example [\"prefix+n\", \"ctrl+n\"].`);
    }
    if (!Array.isArray(shortcuts) || shortcuts.some((shortcut) => typeof shortcut !== "string")) {
      throw new Error(`${definition.label} shortcut arrays may contain only strings.`);
    }
    return JSON.stringify(shortcuts);
  }
  return definition.literalKind === "string" ? JSON.stringify(validated) : validated;
}

function replaceExistingAssignments(
  lines: string[],
  changes: Map<string, { definition: HerdrSettingDefinition; literal?: string }>,
): Set<string> {
  const locations = new Map<string, number>();
  let tablePath: string[] = [];
  for (const [index, line] of lines.entries()) {
    const header = parseTableHeader(line);
    if (header) {
      tablePath = header;
      continue;
    }
    const assignment = parseAssignment(line, tablePath);
    if (assignment && changes.has(assignment.path)) locations.set(assignment.path, index);
  }

  for (const [settingPath, index] of locations) {
    const assignment = parseAssignment(lines[index]!, tablePathForLine(lines, index));
    const change = changes.get(settingPath)!;
    if (assignment) {
      lines[index] = change.literal === undefined
        ? assignment.comment.trimStart()
        : `${assignment.prefix}${change.literal}${assignment.comment}`;
    }
  }
  return new Set(locations.keys());
}

function tablePathForLine(lines: string[], targetIndex: number): string[] {
  let tablePath: string[] = [];
  for (let index = 0; index < targetIndex; index += 1) {
    const header = parseTableHeader(lines[index]!);
    if (header) tablePath = header;
  }
  return tablePath;
}

function contentEnd(lines: string[], start: number, end: number): number {
  let index = end;
  while (index > start && !lines[index - 1]!.trim()) index -= 1;
  return index;
}

function insertAssignment(lines: string[], definition: HerdrSettingDefinition, literal: string): void {
  const assignment = `${definition.key} = ${literal}`;
  if (definition.tablePath.length === 0) {
    const firstHeader = lines.findIndex((line) => parseTableHeader(line) !== undefined);
    const boundary = firstHeader === -1 ? lines.length : firstHeader;
    lines.splice(contentEnd(lines, 0, boundary), 0, assignment);
    return;
  }

  const targetTable = normalizePath(definition.tablePath);
  let headerIndex = -1;
  let tableEnd = lines.length;
  for (const [index, line] of lines.entries()) {
    const header = parseTableHeader(line);
    if (!header) continue;
    if (headerIndex !== -1) {
      tableEnd = index;
      break;
    }
    if (normalizePath(header) === targetTable && !line.trimStart().startsWith("[[")) headerIndex = index;
  }

  if (headerIndex !== -1) {
    lines.splice(contentEnd(lines, headerIndex + 1, tableEnd), 0, assignment);
    return;
  }

  const end = contentEnd(lines, 0, lines.length);
  const addition = [`[${targetTable}]`, assignment];
  if (end > 0) addition.unshift("");
  lines.splice(end, 0, ...addition);
}

export function buildHerdrConfig(source: string, values: Record<string, string>): string {
  const parsed = parseHerdrAssignments(source);
  const changes = new Map<string, { definition: HerdrSettingDefinition; literal?: string }>();
  for (const definition of HERDR_SETTINGS) {
    const currentValue = parsed.values[definition.path] ?? definition.defaultValue;
    const requestedValue = values[definition.path] ?? currentValue;
    if (requestedValue === currentValue) continue;
    const normalizedValue = validateHerdrValue(definition, requestedValue);
    changes.set(definition.path, {
      definition,
      literal: definition.removeWhenEmpty && normalizedValue === ""
        ? undefined
        : formatLiteral(definition, normalizedValue),
    });
  }
  if (changes.size === 0) return source;

  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const replaced = replaceExistingAssignments(lines, changes);
  for (const [settingPath, change] of changes) {
    if (!replaced.has(settingPath) && change.literal !== undefined) {
      insertAssignment(lines, change.definition, change.literal);
    }
  }
  return lines.join(eol);
}

export function herdrConfigWarnings(values: Record<string, string>): string[] {
  const warnings: string[] = [];
  const minimum = Number(values["ui.sidebar_min_width"]);
  const maximum = Number(values["ui.sidebar_max_width"]);
  const width = Number(values["ui.sidebar_width"]);
  if (minimum > maximum) warnings.push("Sidebar minimum cannot be greater than its maximum.");
  if (width < minimum || width > maximum) {
    warnings.push("Sidebar width is outside the configured minimum and maximum range.");
  }
  for (const settingPath of ["ui.sound.path", "ui.sound.done_path", "ui.sound.request_path"]) {
    const soundPath = values[settingPath]?.trim();
    if (soundPath && !soundPath.toLowerCase().endsWith(".mp3")) {
      warnings.push(`${definitionsByPath.get(settingPath)!.label} must point to an mp3 file.`);
    }
  }
  return warnings;
}

export async function saveHerdrConfig(
  snapshot: HerdrConfigSnapshot,
  values: Record<string, string>,
): Promise<HerdrConfigSaveResult> {
  let currentSource = "";
  let currentExists = false;
  let currentMode = 0o600;

  try {
    currentSource = await readFile(snapshot.path, "utf8");
    currentExists = true;
    currentMode = (await stat(snapshot.path)).mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (currentSource !== snapshot.source || currentExists !== snapshot.exists) {
    throw new Error("Herdr config changed on disk. Reopen the tool before saving.");
  }

  const source = buildHerdrConfig(snapshot.source, values);
  if (source === snapshot.source) return { ...parseHerdrConfig(snapshot.path, source, currentExists) };

  await mkdir(path.dirname(snapshot.path), { recursive: true });
  let backupPath: string | undefined;
  if (currentExists) {
    backupPath = `${snapshot.path}.buttler.bak`;
    await copyFile(snapshot.path, backupPath);
  }

  const temporaryPath = `${snapshot.path}.buttler.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, source, { encoding: "utf8", mode: currentMode });
    await rename(temporaryPath, snapshot.path);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }

  return { ...parseHerdrConfig(snapshot.path, source, true), backupPath };
}

export function herdrSetting(settingPath: string): HerdrSettingDefinition {
  const definition = definitionsByPath.get(settingPath);
  if (!definition) throw new Error(`Unknown Herdr setting: ${settingPath}`);
  return definition;
}

export function adjustHerdrValue(
  definition: HerdrSettingDefinition,
  rawValue: string,
  direction: -1 | 1,
): string {
  if (definition.kind === "choice") {
    const choices = definition.choices ?? [];
    if (choices.length === 0) return rawValue;
    const currentIndex = Math.max(0, choices.indexOf(rawValue));
    return choices[(currentIndex + direction + choices.length) % choices.length]!;
  }
  if (definition.kind !== "number") return rawValue;

  const fallback = Number(definition.defaultValue);
  const current = Number.isFinite(Number(rawValue)) ? Number(rawValue) : fallback;
  const min = definition.min ?? Number.NEGATIVE_INFINITY;
  const max = definition.max ?? Number.POSITIVE_INFINITY;
  const step = definition.step ?? 1;
  return Math.min(max, Math.max(min, current + step * direction)).toFixed(definition.decimals ?? 0);
}
