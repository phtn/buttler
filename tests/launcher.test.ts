import { expect, test } from "bun:test";
import type { BoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { VERSION } from "../core";
import {
  ANALYZER_TOOL,
  createToolLauncher,
  KITTY_TOOL,
  MORTI_TOOL,
  type ToolDefinition,
} from "../ui/launcher";

const tools: ToolDefinition[] = [
  MORTI_TOOL,
  ANALYZER_TOOL,
  KITTY_TOOL,
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `tool-${index + 1}`,
    name: `Tool ${index + 1}`,
    glyph: "◆",
    description: "Does a thing",
  })),
];

test("tool launcher renders square tiles and supports arrow and Vim navigation", async () => {
  const setup = await createTestRenderer({ width: 74, height: 28 });
  let launched = "";
  let quit = false;
  const launcher = createToolLauncher(setup.renderer, tools, {
    projectName: "example",
    onLaunch: (tool) => {
      launched = tool.id;
    },
    onQuit: () => {
      quit = true;
    },
  });

  try {
    await setup.flush();
    const frame = setup.captureCharFrame();
    const grid = launcher.root.findDescendantById("tool-grid") as BoxRenderable;
    const mortiTile = launcher.root.findDescendantById("tool-morti") as BoxRenderable;
    const brand = launcher.root.findDescendantById("launcher-brand") as TextRenderable;
    const introduction = launcher.root.findDescendantById("launcher-introduction") as TextRenderable;
    const version = launcher.root.findDescendantById("launcher-version") as TextRenderable;

    expect(frame).toContain("🅿 ⧸example");
    expect(frame).toContain("example");
    expect(frame).toContain(`v${VERSION}`);
    expect(frame).toContain("MORTI");
    expect(frame).toContain("⦵ MORTI");
    expect(frame).toContain("clear dead code");
    expect(frame).toContain("ANALYZER");
    expect(frame).toContain("find risky patterns");
    expect(frame).toContain("KITTY");
    expect(frame).toContain("tune your terminal");
    expect(frame.split("\n").find((line) => line.includes("╔"))).not.toContain("Morti");
    expect(frame).toContain("⛖ navigate");
    expect(brand.y).toBe(introduction.y);
    expect(introduction.y).toBe(version.y);
    expect(Math.abs(introduction.x + introduction.width / 2 - setup.renderer.terminalWidth / 2)).toBeLessThanOrEqual(1);
    expect(version.x + version.width).toBe(setup.renderer.terminalWidth - 1);
    expect(mortiTile.x).toBe(grid.x);
    expect(mortiTile.y).toBe(grid.y + 1);
    expect(mortiTile.width).toBe(22);
    expect(mortiTile.height).toBe(7);
    expect(launcher.selectedIndex).toBe(0);

    setup.mockInput.pressArrow("right");
    await setup.flush();
    expect(launcher.selectedIndex).toBe(1);

    setup.mockInput.pressKey("j");
    await setup.flush();
    expect(launcher.selectedIndex).toBe(4);

    setup.mockInput.pressKey("h");
    await setup.flush();
    expect(launcher.selectedIndex).toBe(3);

    setup.mockInput.pressKey("k");
    await setup.flush();
    expect(launcher.selectedIndex).toBe(0);

    setup.mockInput.pressKey("l");
    await setup.flush();
    expect(launcher.selectedIndex).toBe(1);

    setup.mockInput.pressEnter();
    await setup.flush();
    expect(launched).toBe(tools[1]!.id);

    setup.mockInput.pressKey("q");
    await setup.flush();
    expect(quit).toBe(true);
  } finally {
    launcher.dispose();
    setup.renderer.destroy();
  }
});
