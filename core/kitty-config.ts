import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type KittySettingGroup = "Colors" | "Font" | "Cursor" | "Window" | "Tabs" | "Behavior";
export type KittySettingKind = "text" | "number" | "choice";

export interface KittySettingDefinition {
  key: string;
  label: string;
  group: KittySettingGroup;
  kind: KittySettingKind;
  defaultValue: string;
  description: string;
  choices?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
}

export interface KittyConfigSnapshot {
  path: string;
  exists: boolean;
  source: string;
  values: Record<string, string>;
  baseValues: Record<string, string>;
  managedValues: Record<string, string>;
  issues: KittyConfigIssue[];
}

export interface KittyConfigIssue {
  line: number;
  key: string;
  message: string;
}

export interface KittyConfigSaveResult extends KittyConfigSnapshot {
  backupPath?: string;
}

export const KITTY_MANAGED_START = "#: Buttler managed settings {{{";
export const KITTY_MANAGED_END = "#: }}} Buttler managed settings";

export const KITTY_SETTINGS: readonly KittySettingDefinition[] = [
  {
    key: "foreground",
    label: "Foreground",
    group: "Colors",
    kind: "text",
    defaultValue: "#dddddd",
    description: "Default text color. Accepts a color name or #RRGGBB value.",
  },
  {
    key: "background",
    label: "Background",
    group: "Colors",
    kind: "text",
    defaultValue: "#000000",
    description: "Default terminal background color.",
  },
  {
    key: "background_opacity",
    label: "Opacity",
    group: "Colors",
    kind: "number",
    defaultValue: "1.00",
    description: "Background opacity from 0.20 (transparent) to 1.00 (opaque).",
    min: 0.2,
    max: 1,
    step: 0.05,
    decimals: 2,
  },
  {
    key: "background_blur",
    label: "Blur",
    group: "Colors",
    kind: "number",
    defaultValue: "0",
    description: "macOS/Wayland background blur radius. Requires opacity below 1.",
    min: 0,
    max: 64,
    step: 1,
    decimals: 0,
  },
  {
    key: "dynamic_background_opacity",
    label: "Dynamic opacity",
    group: "Colors",
    kind: "choice",
    defaultValue: "no",
    description: "Allow opacity to be changed in running Kitty windows.",
    choices: ["no", "yes"],
  },
  {
    key: "font_family",
    label: "Font family",
    group: "Font",
    kind: "text",
    defaultValue: "monospace",
    description: "Font family used for regular terminal text.",
  },
  {
    key: "font_size",
    label: "Font size",
    group: "Font",
    kind: "number",
    defaultValue: "11.0",
    description: "Font size in points.",
    min: 6,
    max: 72,
    step: 0.5,
    decimals: 1,
  },
  {
    key: "disable_ligatures",
    label: "Ligatures",
    group: "Font",
    kind: "choice",
    defaultValue: "never",
    description: "When to disable programming ligatures.",
    choices: ["never", "cursor", "always"],
  },
  {
    key: "cursor_shape",
    label: "Shape",
    group: "Cursor",
    kind: "choice",
    defaultValue: "block",
    description: "Default cursor shape; terminal applications can override it.",
    choices: ["block", "beam", "underline"],
  },
  {
    key: "cursor_blink_interval",
    label: "Blink interval",
    group: "Cursor",
    kind: "number",
    defaultValue: "-1.0",
    description: "Seconds between blinks. -1 uses the system default; 0 disables blinking.",
    min: -1,
    max: 2,
    step: 0.1,
    decimals: 1,
  },
  {
    key: "window_padding_width",
    label: "Padding",
    group: "Window",
    kind: "number",
    defaultValue: "0",
    description: "Space in points between terminal text and the window border.",
    min: 0,
    max: 40,
    step: 1,
    decimals: 0,
  },
  {
    key: "window_margin_width",
    label: "Margin",
    group: "Window",
    kind: "number",
    defaultValue: "0",
    description: "Space in points outside Kitty window borders.",
    min: 0,
    max: 40,
    step: 1,
    decimals: 0,
  },
  {
    key: "confirm_os_window_close",
    label: "Close confirmation",
    group: "Window",
    kind: "number",
    defaultValue: "-1",
    description: "Confirm when this many windows are open. 0 disables; negative ignores idle shells.",
    min: -10,
    max: 10,
    step: 1,
    decimals: 0,
  },
  {
    key: "tab_bar_style",
    label: "Bar style",
    group: "Tabs",
    kind: "choice",
    defaultValue: "fade",
    description: "Visual style for the tab bar.",
    choices: ["fade", "slant", "separator", "powerline", "hidden"],
  },
  {
    key: "tab_bar_edge",
    label: "Bar edge",
    group: "Tabs",
    kind: "choice",
    defaultValue: "bottom",
    description: "Place the tab bar at the top or bottom of the window.",
    choices: ["bottom", "top"],
  },
  {
    key: "tab_powerline_style",
    label: "Powerline style",
    group: "Tabs",
    kind: "choice",
    defaultValue: "angled",
    description: "Separator shape used by the powerline tab style.",
    choices: ["angled", "slanted", "round"],
  },
  {
    key: "scrollback_lines",
    label: "Scrollback lines",
    group: "Behavior",
    kind: "number",
    defaultValue: "2000",
    description: "Lines of history retained in memory. -1 is effectively unlimited.",
    min: -1,
    max: 100000,
    step: 1000,
    decimals: 0,
  },
  {
    key: "copy_on_select",
    label: "Copy on select",
    group: "Behavior",
    kind: "choice",
    defaultValue: "no",
    description: "Copy mouse selections directly to the system clipboard.",
    choices: ["no", "clipboard"],
  },
  {
    key: "enable_audio_bell",
    label: "Audio bell",
    group: "Behavior",
    kind: "choice",
    defaultValue: "yes",
    description: "Play a sound when a terminal bell is emitted.",
    choices: ["yes", "no"],
  },
  {
    key: "visual_bell_duration",
    label: "Visual bell",
    group: "Behavior",
    kind: "number",
    defaultValue: "0.0",
    description: "Screen flash duration in seconds; 0 disables the visual bell.",
    min: 0,
    max: 5,
    step: 0.1,
    decimals: 1,
  },
] as const;

const definitionsByKey = new Map(KITTY_SETTINGS.map((setting) => [setting.key, setting]));

function defaultValues(): Record<string, string> {
  return Object.fromEntries(KITTY_SETTINGS.map((setting) => [setting.key, setting.defaultValue]));
}

function splitManagedBlock(source: string): { baseSource: string; managedSource: string } {
  const start = source.indexOf(KITTY_MANAGED_START);
  if (start === -1) return { baseSource: source, managedSource: "" };

  const endMarker = source.indexOf(KITTY_MANAGED_END, start + KITTY_MANAGED_START.length);
  if (endMarker === -1) return { baseSource: source, managedSource: "" };

  let end = endMarker + KITTY_MANAGED_END.length;
  if (source.slice(end, end + 2) === "\r\n") end += 2;
  else if (source[end] === "\n") end += 1;

  return {
    baseSource: `${source.slice(0, start)}${source.slice(end)}`,
    managedSource: source.slice(start, end),
  };
}

export function parseKittyDirectives(source: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z][\w-]*)(?:\s+(.*))?$/.exec(trimmed);
    if (!match) continue;
    values[match[1]!] = match[2]?.trim() ?? "";
  }

  return values;
}

export function findKittyConfigIssues(source: string): KittyConfigIssue[] {
  const issues: KittyConfigIssue[] = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z][\w-]*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1]!;
    issues.push({
      line: index + 1,
      key,
      message: `Line ${index + 1}: ${key} has no value and Kitty will ignore it.`,
    });
  }
  return issues;
}

function normalizedValues(source: string): Record<string, string> {
  const values = defaultValues();
  const parsed = parseKittyDirectives(source);
  for (const setting of KITTY_SETTINGS) {
    if (parsed[setting.key] !== undefined) values[setting.key] = parsed[setting.key]!;
  }
  return values;
}

export function parseKittyConfig(pathname: string, source: string, exists = true): KittyConfigSnapshot {
  const { baseSource, managedSource } = splitManagedBlock(source);
  const baseValues = normalizedValues(baseSource);
  const managedValues = parseKittyDirectives(managedSource);
  const values = { ...baseValues };

  for (const setting of KITTY_SETTINGS) {
    if (managedValues[setting.key] !== undefined) values[setting.key] = managedValues[setting.key]!;
  }

  return { path: pathname, exists, source, values, baseValues, managedValues, issues: findKittyConfigIssues(source) };
}

export function defaultKittyConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configRoot = xdgConfigHome ? path.resolve(xdgConfigHome) : path.join(os.homedir(), ".config");
  return path.join(configRoot, "kitty", "kitty.conf");
}

export async function loadKittyConfig(configPath = defaultKittyConfigPath()): Promise<KittyConfigSnapshot> {
  try {
    const source = await readFile(configPath, "utf8");
    return parseKittyConfig(configPath, source, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseKittyConfig(configPath, "", false);
    throw error;
  }
}

export function validateKittyValue(definition: KittySettingDefinition, rawValue: string): string {
  const value = rawValue.trim();
  if (!value) throw new Error(`${definition.label} cannot be empty.`);
  if (/[\r\n]/.test(value)) throw new Error(`${definition.label} must fit on one line.`);

  if (definition.kind === "choice") {
    if (!definition.choices?.includes(value)) {
      throw new Error(`${definition.label} must be one of: ${definition.choices?.join(", ")}.`);
    }
    return value;
  }

  if (definition.kind === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${definition.label} must be a number.`);
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

export function adjustKittyValue(
  definition: KittySettingDefinition,
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
  let next: number;

  if (min < 0 && step > 1 && current === min && direction > 0) next = 0;
  else if (min < 0 && step > 1 && current === 0 && direction < 0) next = min;
  else next = current + step * direction;

  return Math.min(max, Math.max(min, next)).toFixed(definition.decimals ?? 0);
}

export function kittyConfigWarnings(values: Record<string, string>): string[] {
  const warnings: string[] = [];
  if (Number(values.background_blur) > 0 && Number(values.background_opacity) >= 1) {
    warnings.push("Background blur has no effect until opacity is below 1.00.");
  }
  return warnings;
}

export function buildKittyConfig(source: string, values: Record<string, string>): string {
  const { baseSource, managedSource } = splitManagedBlock(source);
  const baseValues = normalizedValues(baseSource);
  const overrides: string[] = [];

  for (const definition of KITTY_SETTINGS) {
    const value = validateKittyValue(definition, values[definition.key] ?? baseValues[definition.key]!);
    if (value !== validateKittyValue(definition, baseValues[definition.key]!)) {
      overrides.push(`${definition.key} ${value}`);
    }
  }

  const cleanBase = baseSource.trimEnd();
  if (overrides.length === 0) {
    if (!managedSource) return source;
    return cleanBase ? `${cleanBase}\n` : "";
  }

  const block = [
    KITTY_MANAGED_START,
    "#: This block is managed by Buttler's Kitty tool.",
    ...overrides,
    KITTY_MANAGED_END,
  ].join("\n");
  return cleanBase ? `${cleanBase}\n\n${block}\n` : `${block}\n`;
}

export async function saveKittyConfig(
  snapshot: KittyConfigSnapshot,
  values: Record<string, string>,
): Promise<KittyConfigSaveResult> {
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
    throw new Error("Kitty config changed on disk. Reopen the tool before saving.");
  }

  const source = buildKittyConfig(snapshot.source, values);
  if (source === snapshot.source) return { ...parseKittyConfig(snapshot.path, source, currentExists) };

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

  return { ...parseKittyConfig(snapshot.path, source, true), backupPath };
}

export function kittySetting(key: string): KittySettingDefinition {
  const definition = definitionsByKey.get(key);
  if (!definition) throw new Error(`Unknown Kitty setting: ${key}`);
  return definition;
}
