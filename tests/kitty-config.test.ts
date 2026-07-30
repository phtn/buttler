import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adjustKittyValue,
  buildKittyConfig,
  findKittyConfigIssues,
  KITTY_MANAGED_START,
  kittyConfigWarnings,
  kittySetting,
  loadKittyConfig,
  parseKittyConfig,
  saveKittyConfig,
  validateKittyValue,
} from "../core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Kitty configuration model", () => {
  test("reads active directives and lets a managed block override them", () => {
    const source = [
      "# font_size 11.0",
      "font_family JetBrainsMono Nerd Font Mono",
      "font_size 13.0",
      "",
      KITTY_MANAGED_START,
      "background_opacity 0.90",
      "#: }}} Buttler managed settings",
      "",
    ].join("\n");
    const snapshot = parseKittyConfig("/tmp/kitty.conf", source);

    expect(snapshot.values.font_family).toBe("JetBrainsMono Nerd Font Mono");
    expect(snapshot.values.font_size).toBe("13.0");
    expect(snapshot.values.background_opacity).toBe("0.90");
    expect(snapshot.baseValues.background_opacity).toBe("1.00");
    expect(snapshot.managedValues.background_opacity).toBe("0.90");
  });

  test("writes only values that differ from the underlying config", () => {
    const source = "font_family JetBrainsMono Nerd Font Mono\nfont_size 13.0\n";
    const snapshot = parseKittyConfig("/tmp/kitty.conf", source);
    const values = { ...snapshot.values, background_opacity: "0.85", font_size: "14.0" };
    const output = buildKittyConfig(source, values);

    expect(output).toContain(KITTY_MANAGED_START);
    expect(output).toContain("background_opacity 0.85");
    expect(output).toContain("font_size 14.0");
    expect(output.match(/^font_family /gm)).toHaveLength(1);

    const reparsed = parseKittyConfig("/tmp/kitty.conf", output);
    expect(reparsed.values.font_size).toBe("14.0");
    expect(buildKittyConfig(output, reparsed.baseValues)).toBe(source);
  });

  test("validates and adjusts curated values", () => {
    const opacity = kittySetting("background_opacity");
    const style = kittySetting("tab_bar_style");

    expect(adjustKittyValue(opacity, "1.00", -1)).toBe("0.95");
    expect(adjustKittyValue(style, "fade", -1)).toBe("hidden");
    expect(validateKittyValue(opacity, "0.7")).toBe("0.70");
    expect(() => validateKittyValue(style, "neon")).toThrow("must be one of");
    expect(kittyConfigWarnings({ background_blur: "10", background_opacity: "1.00" })).toHaveLength(1);
    expect(findKittyConfigIssues("background #000000\ntransparent_background_colors\n")).toEqual([
      {
        line: 2,
        key: "transparent_background_colors",
        message: "Line 2: transparent_background_colors has no value and Kitty will ignore it.",
      },
    ]);
  });
});

describe("Kitty configuration writes", () => {
  test("saves atomically, backs up the original, and rejects stale snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buttler-kitty-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "kitty.conf");
    const original = "font_size 13.0\n";
    await writeFile(configPath, original);

    const snapshot = await loadKittyConfig(configPath);
    const saved = await saveKittyConfig(snapshot, { ...snapshot.values, font_size: "14.0" });
    expect(await readFile(configPath, "utf8")).toContain("font_size 14.0");
    expect(await readFile(`${configPath}.buttler.bak`, "utf8")).toBe(original);
    expect(saved.values.font_size).toBe("14.0");

    await writeFile(configPath, "font_size 15.0\n");
    await expect(saveKittyConfig(saved, { ...saved.values, font_size: "16.0" })).rejects.toThrow(
      "changed on disk",
    );
  });
});
