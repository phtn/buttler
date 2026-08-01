import { expect, test } from "bun:test";
import type { BoxRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { MemoryMonitor } from "../core";
import { createMemoryDashboard } from "../ui/memory-dashboard";

const MEBIBYTE = 1024 * 1024;

test("Memory dashboard renders growth, controls sampling, and returns", async () => {
  const setup = await createTestRenderer({ width: 110, height: 28 });
  let index = 0;
  let wentBack = false;
  const monitor = new MemoryMonitor({
    sampler: () => ({
      heapUsed: (20 + index * 1.5) * MEBIBYTE,
      heapTotal: 60 * MEBIBYTE,
      rss: (80 + index++ * 2) * MEBIBYTE,
      external: 2 * MEBIBYTE,
      arrayBuffers: MEBIBYTE,
    }),
  });
  const dashboard = createMemoryDashboard(setup.renderer, {
    monitor,
    autoStart: false,
    onBack: () => {
      wentBack = true;
    },
  });

  try {
    for (let sample = 0; sample < 12; sample += 1) {
      dashboard.sample(sample * 1_000);
    }
    await setup.flush();
    let frame = setup.captureCharFrame();
    const trendsPanel = dashboard.root.findDescendantById("memory-trends-panel") as BoxRenderable;
    const insightPanel = dashboard.root.findDescendantById("memory-insight-panel") as BoxRenderable;

    expect(frame).toContain("Memory");
    expect(frame).toContain("current Buttler process");
    expect(frame).toContain("GROWTH SIGNAL");
    expect(frame).toContain("Confidence: HIGH");
    expect(frame).toContain("Signals: HEAP, RSS");
    expect(frame).toContain("heap snapshot");
    expect(trendsPanel.y).toBe(insightPanel.y);

    setup.mockInput.pressKey("r");
    await setup.flush();
    expect(dashboard.monitor.measurements).toHaveLength(1);
    expect(setup.captureCharFrame()).toContain("COLLECTING BASELINE");

    setup.resize(78, 28);
    await setup.flush();
    expect(insightPanel.y).toBeGreaterThan(trendsPanel.y);

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);

    setup.mockInput.pressKey(" ");
    await setup.flush();
    expect(dashboard.paused).toBe(true);
    frame = setup.captureCharFrame();
    expect(frame).toContain("paused");
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});
