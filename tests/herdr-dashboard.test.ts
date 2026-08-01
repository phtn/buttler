import { expect, test } from "bun:test";
import type { TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildHerdrConfig, HERDR_SETTINGS, parseHerdrConfig, saveHerdrConfig } from "../core";
import { createHerdrDashboard } from "../ui/herdr-dashboard";

test("Herdr dashboard shows effective values, edits them, and saves", async () => {
  const setup = await createTestRenderer({ width: 110, height: 30 });
  const source = [
    "[theme]",
    'name = "catppuccin"',
    "",
    "[ui]",
    "sidebar_width = 26",
    "sidebar_min_width = 18",
    "sidebar_max_width = 36",
    "",
  ].join("\n");
  const snapshot = parseHerdrConfig("/Users/example/.config/herdr/config.toml", source);
  let saves = 0;
  let applies = 0;
  let applyShouldFail = false;
  let wentBack = false;
  const dashboard = createHerdrDashboard(setup.renderer, snapshot, {
    onSave: async (current, values) => {
      saves += 1;
      return parseHerdrConfig(current.path, buildHerdrConfig(current.source, values));
    },
    onBack: () => {
      wentBack = true;
    },
    onApplyConfig: async () => {
      applies += 1;
      if (applyShouldFail) throw new Error("server unavailable");
    },
  });

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Herdr");
    expect(frame).toContain("Onboarding");
    expect(frame).toContain("CATEGORIES · 13");
    expect(frame).toContain("THEME");
    expect(frame).toContain("KEYS");
    expect(frame).toContain("56 settings");
    expect(frame).toContain("✓ saved");

    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(dashboard.selectedCategory.group).toBe("Theme");
    expect(setup.captureCharFrame()).toContain("Theme selection and automatic light");

    setup.mockInput.pressEnter();
    await setup.flush();
    expect(dashboard.view).toBe("settings");
    expect(dashboard.settingList.options).toHaveLength(4);
    expect(dashboard.settingList.options[0]!.name).toContain("catppuccin");
    expect(dashboard.settingList.options[1]!.name).toContain("Auto switch");

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(dashboard.view).toBe("categories");
    expect(wentBack).toBe(false);

    dashboard.openCategory("UI");
    dashboard.settingList.setSelectedIndex(
      HERDR_SETTINGS.filter((setting) => setting.group === "UI")
        .findIndex((setting) => setting.path === "ui.sidebar_width"),
    );
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("26");

    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(dashboard.values["ui.sidebar_width"]).toBe("27");
    frame = setup.captureCharFrame();
    expect(frame).toContain("● unsaved");

    setup.mockInput.pressKey("s");
    await Promise.resolve();
    await setup.flush();
    expect(saves).toBe(1);
    expect(dashboard.values["ui.sidebar_width"]).toBe("27");
    expect(setup.captureCharFrame()).toContain("✓ saved");
    expect(setup.captureCharFrame()).toContain("reload Herdr config now?");
    expect(setup.captureCharFrame()).toContain("y reload now");

    setup.mockInput.pressKey("y");
    await Promise.resolve();
    await setup.flush();
    expect(applies).toBe(1);
    expect(setup.captureCharFrame()).toContain("Herdr config reloaded");

    setup.mockInput.pressArrow("right");
    setup.mockInput.pressKey("s");
    await Promise.resolve();
    await setup.flush();
    expect(saves).toBe(2);
    expect(setup.captureCharFrame()).toContain("reload Herdr config now?");

    setup.mockInput.pressKey("n");
    await setup.flush();
    expect(applies).toBe(1);
    expect(setup.captureCharFrame()).toContain("Saved · reload skipped");

    setup.mockInput.pressArrow("right");
    setup.mockInput.pressKey("s");
    await Promise.resolve();
    await setup.flush();
    applyShouldFail = true;
    setup.mockInput.pressKey("y");
    await Promise.resolve();
    await setup.flush();
    expect(applies).toBe(2);
    expect(setup.captureCharFrame()).toContain("Saved · reload failed: serv");

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(dashboard.view).toBe("categories");
    expect(wentBack).toBe(false);

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);

    const summary = dashboard.root.findDescendantById("herdr-summary") as TextRenderable;
    expect(summary.y).toBe(0);
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});

test("Herdr dashboard can switch the active config path", async () => {
  const setup = await createTestRenderer({ width: 110, height: 30 });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "buttler-herdr-path-"));

  try {
    const primaryPath = path.join(tempDir, "config-a.toml");
    const secondaryPath = path.join(tempDir, "config-b.toml");
    await writeFile(primaryPath, '[theme]\nname = "catppuccin"\n');
    await writeFile(secondaryPath, '[theme]\nname = "nord"\n');

    const snapshot = parseHerdrConfig(primaryPath, await readFile(primaryPath, "utf8"));
    const dashboard = createHerdrDashboard(setup.renderer, snapshot, {
      onSave: async (current, values) => saveHerdrConfig(current, values),
    });

    try {
      await setup.flush();

      setup.mockInput.pressKey("p");
      await setup.flush();
      await setup.mockInput.typeText(secondaryPath);
      setup.mockInput.pressEnter();
      await Promise.resolve();
      await setup.flush();

      expect(dashboard.configPathInput.value).toBe(secondaryPath);

      dashboard.openCategory("Theme");
      dashboard.settingList.setSelectedIndex(0);
      await setup.flush();
      setup.mockInput.pressEnter();
      await setup.flush();
      dashboard.valueInput.value = "terminal";
      setup.mockInput.pressEnter();
      await setup.flush();
      setup.mockInput.pressKey("s");
      await Promise.resolve();
      await setup.flush();

      expect(await readFile(primaryPath, "utf8")).toContain('name = "catppuccin"');
      expect(await readFile(secondaryPath, "utf8")).toContain('name = "terminal"');
    } finally {
      dashboard.dispose();
    }
  } finally {
    setup.renderer.destroy();
    await rm(tempDir, { recursive: true });
  }
});
