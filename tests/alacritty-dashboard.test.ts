import { expect, test } from "bun:test";
import type { TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAlacrittyConfig, parseAlacrittyConfig, saveAlacrittyConfig } from "../core";
import { createAlacrittyDashboard } from "../ui/alacritty-dashboard";

test("Alacritty dashboard shows effective values, edits them, and saves", async () => {
  const setup = await createTestRenderer({ width: 110, height: 30 });
  const source = [
    "live_config_reload = true",
    "[window]",
    "opacity = 1.0",
    "blur = true",
    "",
    "[font]",
    "size = 11.25",
    "",
  ].join("\n");
  const snapshot = parseAlacrittyConfig("/Users/example/.config/alacritty/alacritty.toml", source);
  let saves = 0;
  let wentBack = false;
  const dashboard = createAlacrittyDashboard(setup.renderer, snapshot, {
    onSave: async (current, values) => {
      saves += 1;
      return parseAlacrittyConfig(current.path, buildAlacrittyConfig(current.source, values));
    },
    onBack: () => {
      wentBack = true;
    },
  });

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Alacritty");
    expect(frame).toContain("Opacity");
    expect(frame).toContain("Window blur has no effect");
    expect(frame).toContain("✓ saved");

    dashboard.settingList.setSelectedIndex(8);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("11.25");

    dashboard.settingList.setSelectedIndex(1);
    await setup.flush();
    setup.mockInput.pressArrow("left");
    await setup.flush();
    expect(dashboard.values["window.opacity"]).toBe("0.95");
    frame = setup.captureCharFrame();
    expect(frame).toContain("● unsaved");

    setup.mockInput.pressKey("s");
    await Promise.resolve();
    await setup.flush();
    expect(saves).toBe(1);
    expect(dashboard.values["window.opacity"]).toBe("0.95");
    expect(setup.captureCharFrame()).toContain("✓ saved");

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);

    const summary = dashboard.root.findDescendantById("alacritty-summary") as TextRenderable;
    expect(summary.y).toBe(0);
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});

test("Alacritty dashboard can switch the active config path", async () => {
  const setup = await createTestRenderer({ width: 110, height: 30 });
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "buttler-alacritty-path-"));

  try {
    const primaryPath = path.join(tempDir, "alacritty-a.toml");
    const secondaryPath = path.join(tempDir, "alacritty-b.toml");
    await writeFile(primaryPath, "[font]\nsize = 11.25\n");
    await writeFile(secondaryPath, "[font]\nsize = 12.00\n");

    const snapshot = parseAlacrittyConfig(primaryPath, await readFile(primaryPath, "utf8"));
    const dashboard = createAlacrittyDashboard(setup.renderer, snapshot, {
      onSave: async (current, values) => saveAlacrittyConfig(current, values),
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

      dashboard.settingList.setSelectedIndex(8);
      await setup.flush();
      setup.mockInput.pressArrow("right");
      await setup.flush();
      setup.mockInput.pressKey("s");
      await Promise.resolve();
      await setup.flush();

      expect(await readFile(primaryPath, "utf8")).toContain("size = 11.25");
      expect(await readFile(secondaryPath, "utf8")).toContain("size = 12.25");
    } finally {
      dashboard.dispose();
    }
  } finally {
    setup.renderer.destroy();
    await rm(tempDir, { recursive: true });
  }
});
