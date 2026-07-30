import { expect, test } from "bun:test";
import type { TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { buildKittyConfig, parseKittyConfig } from "../core";
import { createKittyDashboard } from "../ui/kitty-dashboard";

test("Kitty dashboard shows effective values, edits them, and saves", async () => {
  const setup = await createTestRenderer({ width: 110, height: 30 });
  const source = [
    "font_family JetBrainsMono Nerd Font Mono",
    "font_size 13.0",
    "background_blur 10",
    "",
  ].join("\n");
  const snapshot = parseKittyConfig("/Users/example/.config/kitty/kitty.conf", source);
  let saves = 0;
  let wentBack = false;
  const dashboard = createKittyDashboard(setup.renderer, snapshot, {
    onSave: async (current, values) => {
      saves += 1;
      return parseKittyConfig(current.path, buildKittyConfig(current.source, values));
    },
    onBack: () => {
      wentBack = true;
    },
  });

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();
    expect(frame).toContain("Kitty");
    expect(frame).toContain("Opacity");
    expect(frame).toContain("Background blur has no effect");
    expect(frame).toContain("✓ saved");

    dashboard.settingList.setSelectedIndex(5);
    await setup.flush();
    expect(setup.captureCharFrame()).toContain("JetBrainsMono Nerd Font Mono");

    dashboard.settingList.setSelectedIndex(2);
    await setup.flush();
    setup.mockInput.pressArrow("left");
    await setup.flush();
    expect(dashboard.values.background_opacity).toBe("0.95");
    frame = setup.captureCharFrame();
    expect(frame).toContain("● unsaved");

    setup.mockInput.pressKey("s");
    await Promise.resolve();
    await setup.flush();
    expect(saves).toBe(1);
    expect(dashboard.values.background_opacity).toBe("0.95");
    expect(setup.captureCharFrame()).toContain("✓ saved");

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);

    const summary = dashboard.root.findDescendantById("kitty-summary") as TextRenderable;
    expect(summary.y).toBe(0);
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});
