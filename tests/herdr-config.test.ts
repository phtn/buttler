import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  adjustHerdrValue,
  buildHerdrConfig,
  findHerdrConfigIssues,
  herdrConfigWarnings,
  herdrSetting,
  loadHerdrConfig,
  parseHerdrConfig,
  saveHerdrConfig,
  validateHerdrValue,
} from "../core";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("Herdr configuration model", () => {
  test("reads explicit values on top of documented defaults", () => {
    const source = [
      "onboarding = false",
      "",
      "[theme]",
      'name = "nord"',
      "",
      "[ui]",
      "sidebar_width = 30 # keep this note",
      "",
    ].join("\n");
    const snapshot = parseHerdrConfig("/tmp/config.toml", source);

    expect(snapshot.values.onboarding).toBe("false");
    expect(snapshot.values["theme.name"]).toBe("nord");
    expect(snapshot.values["ui.sidebar_width"]).toBe("30");
    expect(snapshot.values["terminal.shell_mode"]).toBe("auto");
    expect(snapshot.configuredValues["ui.sidebar_width"]).toBe("30");
    expect(snapshot.configuredValues["terminal.shell_mode"]).toBeUndefined();
  });

  test("updates existing TOML keys and inserts missing keys without duplicate tables", () => {
    const source = [
      "[theme]",
      'name = "catppuccin"',
      "",
      "[ui]",
      "sidebar_width = 26 # keep this note",
      "",
      "[ui.toast]",
      'delivery = "off"',
      "",
      "[ui.sound]",
      'path = "sounds/notification.mp3"',
      "",
    ].join("\n");
    const snapshot = parseHerdrConfig("/tmp/config.toml", source);
    const output = buildHerdrConfig(source, {
      ...snapshot.values,
      "theme.name": "nord",
      "ui.sidebar_width": "30",
      "ui.copy_on_select": "false",
      "ui.toast.delivery": "herdr",
      "ui.sound.path": "",
      "remote.manage_ssh_config": "false",
    });

    expect(output).toContain('name = "nord"');
    expect(output).toContain("sidebar_width = 30 # keep this note");
    expect(output).toContain("copy_on_select = false");
    expect(output).toContain('delivery = "herdr"');
    expect(output.match(/^\[ui\]$/gm)).toHaveLength(1);
    expect(output.match(/^\[ui\.toast\]$/gm)).toHaveLength(1);
    expect(output.match(/^\[remote\]$/gm)).toHaveLength(1);
    expect(output).not.toContain("notification.mp3");

    const reparsed = parseHerdrConfig("/tmp/config.toml", output);
    expect(reparsed.values["theme.name"]).toBe("nord");
    expect(reparsed.values["ui.copy_on_select"]).toBe("false");
    expect(reparsed.values["remote.manage_ssh_config"]).toBe("false");
    expect(buildHerdrConfig(output, reparsed.values)).toBe(output);
  });

  test("validates, adjusts, and warns about curated settings", () => {
    const sidebar = herdrSetting("ui.sidebar_width");
    const delivery = herdrSetting("ui.toast.delivery");
    const shell = herdrSetting("terminal.default_shell");

    expect(adjustHerdrValue(sidebar, "26", 1)).toBe("27");
    expect(adjustHerdrValue(delivery, "off", -1)).toBe("system");
    expect(validateHerdrValue(sidebar, "32")).toBe("32");
    expect(validateHerdrValue(shell, "")).toBe("");
    expect(() => validateHerdrValue(sidebar, "2.5")).toThrow("whole number");
    expect(() => validateHerdrValue(delivery, "email")).toThrow("must be one of");
    expect(
      herdrConfigWarnings({
        "ui.sidebar_width": "30",
        "ui.sidebar_min_width": "40",
        "ui.sidebar_max_width": "20",
        "ui.sound.path": "notification.wav",
      }),
    ).toHaveLength(3);
    expect(findHerdrConfigIssues("[ui]\nsidebar_width\n")).toEqual([
      {
        line: 2,
        key: "sidebar_width",
        message: "Line 2: sidebar_width has no value and Herdr will ignore it.",
      },
    ]);
  });

  test("edits the complete standard keymap and supports multiple shortcuts", () => {
    const source = [
      "[keys]",
      'next_tab = "prefix+n"',
      "",
      "[[keys.command]]",
      'key = "prefix+alt+g"',
      'type = "popup"',
      'command = "lazygit"',
      "",
    ].join("\n");
    const snapshot = parseHerdrConfig("/tmp/config.toml", source);
    const output = buildHerdrConfig(source, {
      ...snapshot.values,
      "keys.next_tab": '["prefix+n", "ctrl+alt+n"]',
      "keys.swap_pane_left": "ctrl+shift+h",
      "keys.indexed.tabs": "ctrl",
    });

    expect(output).toContain('next_tab = ["prefix+n","ctrl+alt+n"]');
    expect(output).toContain('swap_pane_left = "ctrl+shift+h"');
    expect(output).toContain("[keys.indexed]");
    expect(output).toContain('tabs = "ctrl"');
    expect(output).toContain("[[keys.command]]\nkey = \"prefix+alt+g\"\ntype = \"popup\"\ncommand = \"lazygit\"");
    expect(parseHerdrConfig("/tmp/config.toml", output).values["keys.next_tab"]).toBe(
      '["prefix+n","ctrl+alt+n"]',
    );
  });
});

describe("Herdr configuration writes", () => {
  test("saves atomically, backs up the original, and rejects stale snapshots", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buttler-herdr-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.toml");
    const original = '[theme]\nname = "catppuccin"\n';
    await writeFile(configPath, original);

    const snapshot = await loadHerdrConfig(configPath);
    const saved = await saveHerdrConfig(snapshot, { ...snapshot.values, "theme.name": "nord" });
    expect(await readFile(configPath, "utf8")).toContain('name = "nord"');
    expect(await readFile(`${configPath}.buttler.bak`, "utf8")).toBe(original);
    expect(saved.values["theme.name"]).toBe("nord");

    await writeFile(configPath, '[theme]\nname = "dracula"\n');
    await expect(saveHerdrConfig(saved, { ...saved.values, "theme.name": "terminal" })).rejects.toThrow(
      "changed on disk",
    );
  });
});
