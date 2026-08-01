import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type AlacrittySettingGroup = "General" | "Window" | "Scrolling" | "Font" | "Cursor" | "Selection" | "Colors";
export type AlacrittySettingKind = "text" | "number" | "choice";
export type AlacrittyLiteralKind = "string" | "number" | "boolean";

export interface AlacrittySettingDefinition {
  path: string;
  key: string;
  tablePath: string[];
  label: string;
  group: AlacrittySettingGroup;
  kind: AlacrittySettingKind;
  literalKind: AlacrittyLiteralKind;
  defaultValue: string;
  description: string;
  choices?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
}

export interface AlacrittyConfigSnapshot {
  path: string;
  exists: boolean;
  source: string;
  values: Record<string, string>;
  baseValues: Record<string, string>;
  managedValues: Record<string, string>;
  issues: AlacrittyConfigIssue[];
}

export interface AlacrittyConfigIssue {
  line: number;
  key: string;
  message: string;
}

export interface AlacrittyConfigSaveResult extends AlacrittyConfigSnapshot {
  backupPath?: string;
}

export const ALACRITTY_MANAGED_START = "#: Buttler managed settings {{{";
export const ALACRITTY_MANAGED_END = "#: }}} Buttler managed settings";

export const ALACRITTY_SETTINGS: readonly AlacrittySettingDefinition[] = [
  {
    path: "live_config_reload",
    key: "live_config_reload",
    tablePath: [],
    label: "Live reload",
    group: "General",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "true",
    description: "Reload configuration changes automatically.",
    choices: ["true", "false"],
  },
  {
    path: "window.opacity",
    key: "opacity",
    tablePath: ["window"],
    label: "Opacity",
    group: "Window",
    kind: "number",
    literalKind: "number",
    defaultValue: "1.00",
    description: "Background opacity from 0.0 (transparent) to 1.0 (opaque).",
    min: 0,
    max: 1,
    step: 0.05,
    decimals: 2,
  },
  {
    path: "window.blur",
    key: "blur",
    tablePath: ["window"],
    label: "Blur",
    group: "Window",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "false",
    description: "Request compositor blur for transparent windows.",
    choices: ["false", "true"],
  },
  {
    path: "window.decorations",
    key: "decorations",
    tablePath: ["window"],
    label: "Decorations",
    group: "Window",
    kind: "choice",
    literalKind: "string",
    defaultValue: "Full",
    description: "Window borders and title bar style.",
    choices: ["Full", "None", "Transparent", "Buttonless"],
  },
  {
    path: "window.dynamic_padding",
    key: "dynamic_padding",
    tablePath: ["window"],
    label: "Dynamic padding",
    group: "Window",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "false",
    description: "Spread extra padding evenly around the terminal content.",
    choices: ["false", "true"],
  },
  {
    path: "window.startup_mode",
    key: "startup_mode",
    tablePath: ["window"],
    label: "Startup mode",
    group: "Window",
    kind: "choice",
    literalKind: "string",
    defaultValue: "Windowed",
    description: "Initial window state when Alacritty opens.",
    choices: ["Windowed", "Maximized", "Fullscreen", "SimpleFullscreen"],
  },
  {
    path: "window.title",
    key: "title",
    tablePath: ["window"],
    label: "Title",
    group: "Window",
    kind: "text",
    literalKind: "string",
    defaultValue: "Alacritty",
    description: "Default window title.",
  },
  {
    path: "scrolling.history",
    key: "history",
    tablePath: ["scrolling"],
    label: "Scrollback lines",
    group: "Scrolling",
    kind: "number",
    literalKind: "number",
    defaultValue: "10000",
    description: "Maximum number of scrollback lines kept in memory.",
    min: 0,
    max: 100000,
    step: 1000,
    decimals: 0,
  },
  {
    path: "font.size",
    key: "size",
    tablePath: ["font"],
    label: "Font size",
    group: "Font",
    kind: "number",
    literalKind: "number",
    defaultValue: "11.25",
    description: "Font size in points.",
    min: 4,
    max: 72,
    step: 0.25,
    decimals: 2,
  },
  {
    path: "font.normal.family",
    key: "family",
    tablePath: ["font", "normal"],
    label: "Font family",
    group: "Font",
    kind: "text",
    literalKind: "string",
    defaultValue: "monospace",
    description: "Regular font family used by Alacritty.",
  },
  {
    path: "font.normal.style",
    key: "style",
    tablePath: ["font", "normal"],
    label: "Font style",
    group: "Font",
    kind: "text",
    literalKind: "string",
    defaultValue: "Regular",
    description: "Regular font style.",
  },
  {
    path: "cursor.style.shape",
    key: "shape",
    tablePath: ["cursor", "style"],
    label: "Cursor shape",
    group: "Cursor",
    kind: "choice",
    literalKind: "string",
    defaultValue: "Block",
    description: "Default cursor shape.",
    choices: ["Block", "Underline", "Beam"],
  },
  {
    path: "cursor.style.blinking",
    key: "blinking",
    tablePath: ["cursor", "style"],
    label: "Cursor blink",
    group: "Cursor",
    kind: "choice",
    literalKind: "string",
    defaultValue: "Off",
    description: "Default cursor blinking mode.",
    choices: ["Never", "Off", "On", "Always"],
  },
  {
    path: "selection.save_to_clipboard",
    key: "save_to_clipboard",
    tablePath: ["selection"],
    label: "Copy selection",
    group: "Selection",
    kind: "choice",
    literalKind: "boolean",
    defaultValue: "false",
    description: "Copy selected text to the primary clipboard.",
    choices: ["false", "true"],
  },
  {
    path: "colors.primary.foreground",
    key: "foreground",
    tablePath: ["colors", "primary"],
    label: "Foreground",
    group: "Colors",
    kind: "text",
    literalKind: "string",
    defaultValue: "#d8d8d8",
    description: "Default terminal foreground color.",
  },
  {
    path: "colors.primary.background",
    key: "background",
    tablePath: ["colors", "primary"],
    label: "Background",
    group: "Colors",
    kind: "text",
    literalKind: "string",
    defaultValue: "#181818",
    description: "Default terminal background color.",
  },
] as const;

const definitionsByPath = new Map(ALACRITTY_SETTINGS.map((setting) => [setting.path, setting]));

function defaultValues(): Record<string, string> {
  return Object.fromEntries(ALACRITTY_SETTINGS.map((setting) => [setting.path, setting.defaultValue]));
}

function splitManagedBlock(source: string): { baseSource: string; managedSource: string } {
  const start = source.indexOf(ALACRITTY_MANAGED_START);
  if (start === -1) return { baseSource: source, managedSource: "" };

  const endMarker = source.indexOf(ALACRITTY_MANAGED_END, start + ALACRITTY_MANAGED_START.length);
  if (endMarker === -1) return { baseSource: source, managedSource: "" };

  let end = endMarker + ALACRITTY_MANAGED_END.length;
  if (source.slice(end, end + 2) === "\r\n") end += 2;
  else if (source[end] === "\n") end += 1;

  return {
    baseSource: `${source.slice(0, start)}${source.slice(end)}`,
    managedSource: source.slice(start, end),
  };
}

function normalizePathParts(parts: string[]): string {
  return parts.join(".");
}

function tableHeaderPath(raw: string): string[] {
  return raw
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
}

function unquoteTomlValue(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function parseTomlAssignments(source: string): Record<string, string> {
  const values = defaultValues();
  let tablePath: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const tableMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (tableMatch) {
      tablePath = tableHeaderPath(tableMatch[1]!);
      continue;
    }

    const assignmentMatch = /^([A-Za-z][\w-]*)\s*=\s*(.+)$/.exec(trimmed);
    if (!assignmentMatch) continue;
    const key = assignmentMatch[1]!;
    const pathParts = [...tablePath, key];
    const fullPath = normalizePathParts(pathParts);
    if (definitionsByPath.has(fullPath)) {
      values[fullPath] = unquoteTomlValue(assignmentMatch[2]!);
    }
  }

  return values;
}

export function findAlacrittyConfigIssues(source: string): AlacrittyConfigIssue[] {
  const issues: AlacrittyConfigIssue[] = [];
  let tablePath: string[] = [];

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const tableMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (tableMatch) {
      tablePath = tableHeaderPath(tableMatch[1]!);
      continue;
    }

    if (/^([A-Za-z][\w-]*)$/.test(trimmed)) {
      issues.push({
        line: index + 1,
        key: trimmed,
        message: `Line ${index + 1}: ${trimmed} has no value and Alacritty will ignore it.`,
      });
      continue;
    }

    const assignmentMatch = /^([A-Za-z][\w-]*)\s*=/.exec(trimmed);
    if (!assignmentMatch) continue;
    const fullPath = normalizePathParts([...tablePath, assignmentMatch[1]!]);
    if (!definitionsByPath.has(fullPath)) continue;
  }

  return issues;
}

function validateLiteral(definition: AlacrittySettingDefinition, rawValue: string): string {
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

export function validateAlacrittyValue(definition: AlacrittySettingDefinition, rawValue: string): string {
  return validateLiteral(definition, rawValue);
}

function formatLiteral(definition: AlacrittySettingDefinition, value: string): string {
  if (definition.literalKind === "boolean") return validateLiteral(definition, value);
  if (definition.literalKind === "number") return validateLiteral(definition, value);
  return JSON.stringify(validateLiteral(definition, value));
}

function buildManagedBlock(values: Record<string, string>, baseValues: Record<string, string>): string {
  const overrides = ALACRITTY_SETTINGS.filter((definition) => values[definition.path] !== baseValues[definition.path]);
  if (overrides.length === 0) return "";

  const buckets = new Map<string, AlacrittySettingDefinition[]>();
  for (const definition of overrides) {
    const tableKey = normalizePathParts(definition.tablePath);
    const bucket = buckets.get(tableKey);
    if (bucket) bucket.push(definition);
    else buckets.set(tableKey, [definition]);
  }

  const parts: string[] = [ALACRITTY_MANAGED_START, "#: This block is managed by Buttler's Alacritty tool."];
  const root = buckets.get("") ?? [];
  for (const definition of root) {
    parts.push(`${definition.path} = ${formatLiteral(definition, values[definition.path] ?? definition.defaultValue)}`);
  }

  const tables = [...buckets.keys()].filter((key) => key.length > 0).sort();
  for (const tableKey of tables) {
    parts.push("");
    parts.push(`[${tableKey}]`);
    for (const definition of buckets.get(tableKey) ?? []) {
      parts.push(`${definition.key} = ${formatLiteral(definition, values[definition.path] ?? definition.defaultValue)}`);
    }
  }

  parts.push(ALACRITTY_MANAGED_END);
  return parts.join("\n");
}

function stripManagedAssignments(source: string, overridePaths: Set<string>): string {
  if (overridePaths.size === 0) return source;

  const output: string[] = [];
  let tablePath: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    const tableMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (tableMatch) {
      tablePath = tableHeaderPath(tableMatch[1]!);
      output.push(line);
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) {
      output.push(line);
      continue;
    }

    const assignmentMatch = /^([A-Za-z][\w-]*)\s*=/.exec(trimmed);
    if (!assignmentMatch) {
      output.push(line);
      continue;
    }

    const fullPath = normalizePathParts([...tablePath, assignmentMatch[1]!]);
    if (!overridePaths.has(fullPath)) {
      output.push(line);
    }
  }

  return output.join("\n");
}

export function parseAlacrittyConfig(pathname: string, source: string, exists = true): AlacrittyConfigSnapshot {
  const { baseSource, managedSource } = splitManagedBlock(source);
  const baseValues = parseTomlAssignments(baseSource);
  const managedValues = parseTomlAssignments(managedSource);
  const values = { ...baseValues, ...managedValues };
  return {
    path: pathname,
    exists,
    source,
    values,
    baseValues,
    managedValues,
    issues: findAlacrittyConfigIssues(source),
  };
}

export function defaultAlacrittyConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configRoot = xdgConfigHome ? path.resolve(xdgConfigHome) : path.join(os.homedir(), ".config");
  return path.join(configRoot, "alacritty", "alacritty.toml");
}

export async function loadAlacrittyConfig(configPath = defaultAlacrittyConfigPath()): Promise<AlacrittyConfigSnapshot> {
  try {
    const source = await readFile(configPath, "utf8");
    return parseAlacrittyConfig(configPath, source, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return parseAlacrittyConfig(configPath, "", false);
    throw error;
  }
}

export function alacrittyConfigWarnings(values: Record<string, string>): string[] {
  const warnings: string[] = [];
  if (Number(values["window.opacity"]) >= 1 && values["window.blur"] === "true") {
    warnings.push("Window blur has no effect until opacity is below 1.00.");
  }
  return warnings;
}

export function buildAlacrittyConfig(source: string, values: Record<string, string>): string {
  const { baseSource, managedSource } = splitManagedBlock(source);
  const baseValues = parseTomlAssignments(baseSource);
  const normalizedValues = { ...baseValues };

  for (const definition of ALACRITTY_SETTINGS) {
    const nextValue = validateLiteral(definition, values[definition.path] ?? baseValues[definition.path] ?? definition.defaultValue);
    normalizedValues[definition.path] = nextValue;
  }

  const overridePaths = new Set(
    ALACRITTY_SETTINGS.filter((definition) => normalizedValues[definition.path] !== baseValues[definition.path]).map(
      (definition) => definition.path,
    ),
  );
  const cleanBase = stripManagedAssignments(baseSource, overridePaths).trimEnd();
  const block = buildManagedBlock(normalizedValues, baseValues);

  if (!block) {
    if (!managedSource) return source;
    return cleanBase ? `${cleanBase}\n` : "";
  }

  return cleanBase ? `${cleanBase}\n\n${block}\n` : `${block}\n`;
}

export async function saveAlacrittyConfig(
  snapshot: AlacrittyConfigSnapshot,
  values: Record<string, string>,
): Promise<AlacrittyConfigSaveResult> {
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
    throw new Error("Alacritty config changed on disk. Reopen the tool before saving.");
  }

  const source = buildAlacrittyConfig(snapshot.source, values);
  if (source === snapshot.source) return { ...parseAlacrittyConfig(snapshot.path, source, currentExists) };

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

  return { ...parseAlacrittyConfig(snapshot.path, source, true), backupPath };
}

export function alacrittySetting(settingPath: string): AlacrittySettingDefinition {
  const definition = definitionsByPath.get(settingPath);
  if (!definition) throw new Error(`Unknown Alacritty setting: ${settingPath}`);
  return definition;
}

export function adjustAlacrittyValue(
  definition: AlacrittySettingDefinition,
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
