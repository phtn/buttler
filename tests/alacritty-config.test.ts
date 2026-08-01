import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adjustAlacrittyValue,
  alacrittyConfigWarnings,
  alacrittySetting,
  ALACRITTY_MANAGED_START,
  buildAlacrittyConfig,
  findAlacrittyConfigIssues,
  loadAlacrittyConfig,
  parseAlacrittyConfig,
  saveAlacrittyConfig,
  validateAlacrittyValue,
} from "../core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Alacritty configuration model", () => {
  test("reads active directives and lets a managed block override them", () => {
    const source = [
      "live_config_reload = true",
      "[window]",
      "opacity = 1.0",
      "",
      "[font]",
      "size = 11.25",
      "",
      ALACRITTY_MANAGED_START,
      "[window]",
      "opacity = 0.90",
      "#: }}} Buttler managed settings",
      "",
    ].join("\n");
    const snapshot = parseAlacrittyConfig("/tmp/alacritty.toml", source);

    expect(snapshot.values["window.opacity"]).toBe("0.90");
    expect(snapshot.values["font.size"]).toBe("11.25");
    expect(snapshot.baseValues["window.opacity"]).toBe("1.0");
    expect(snapshot.managedValues["window.opacity"]).toBe("0.90");
  });

  test("writes only values that differ from the underlying config", () => {
    const source = [
      "live_config_reload = true",
      "[window]",
      "opacity = 1.0",
      "",
      "[font]",
      "size = 11.25",
      "",
    ].join("\n");
    const snapshot = parseAlacrittyConfig("/tmp/alacritty.toml", source);
    const values = { ...snapshot.values, "window.opacity": "0.85", "font.size": "12.00" };
    const output = buildAlacrittyConfig(source, values);

    expect(output).toContain(ALACRITTY_MANAGED_START);
    expect(output).toContain("[window]");
    expect(output).toContain("opacity = 0.85");
    expect(output).toContain("[font]");
    expect(output).toContain("size = 12.00");
    expect(output).not.toContain("opacity = 1.0");

    const reparsed = parseAlacrittyConfig("/tmp/alacritty.toml", output);
    expect(reparsed.values["window.opacity"]).toBe("0.85");
    expect(reparsed.values["font.size"]).toBe("12.00");
    expect(buildAlacrittyConfig(output, reparsed.baseValues)).toBe(source);
  });

  test("validates and adjusts curated values", () => {
    const opacity = alacrittySetting("window.opacity");
    const decorations = alacrittySetting("window.decorations");
    const cursor = alacrittySetting("cursor.style.blinking");

    expect(adjustAlacrittyValue(opacity, "1.00", -1)).toBe("0.95");
    expect(adjustAlacrittyValue(decorations, "Full", -1)).toBe("Buttonless");
    expect(adjustAlacrittyValue(cursor, "Off", 1)).toBe("On");
    expect(validateAlacrittyValue(opacity, "0.7")).toBe("0.70");
    expect(() => validateAlacrittyValue(decorations, "Neon")).toThrow("must be one of");
    expect(alacrittyConfigWarnings({ "window.opacity": "1.00", "window.blur": "true" })).toHaveLength(1);
    expect(findAlacrittyConfigIssues("live_config_reload = true\nwindow\n")).toEqual([
      {
        line: 2,
        key: "window",
        message: "Line 2: window has no value and Alacritty will ignore it.",
      },
    ]);
  });
});

describe("Alacritty configuration writes", () => {
  test("saves atomically, backs up the original, and rejects stale snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buttler-alacritty-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "alacritty.toml");
    const original = [
      "live_config_reload = true",
      "[font]",
      "size = 11.25",
      "",
    ].join("\n");
    await writeFile(configPath, original);

    const snapshot = await loadAlacrittyConfig(configPath);
    const saved = await saveAlacrittyConfig(snapshot, { ...snapshot.values, "font.size": "12.00" });
    expect(await readFile(configPath, "utf8")).toContain("size = 12.00");
    expect(await readFile(`${configPath}.buttler.bak`, "utf8")).toBe(original);
    expect(saved.values["font.size"]).toBe("12.00");

    await writeFile(configPath, "live_config_reload = false\n[font]\nsize = 13.00\n");
    await expect(saveAlacrittyConfig(saved, { ...saved.values, "font.size": "13.00" })).rejects.toThrow(
      "changed on disk",
    );
  });
});
