import { expect, test } from "bun:test";
import type { BoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { CodeHealthAnalysis } from "../core";
import { createAnalyzerDashboard } from "../ui/analyzer-dashboard";

const analysis: CodeHealthAnalysis = {
  root: "/workspace/example",
  files: [
    {
      absolutePath: "/workspace/example/src/clean.ts",
      path: "src/clean.ts",
      issues: [],
      diagnostics: [],
    },
    {
      absolutePath: "/workspace/example/src/leaking.tsx",
      path: "src/leaking.tsx",
      issues: [
        {
          type: "event-listener-leak",
          severity: "high",
          file: "src/leaking.tsx",
          absolutePath: "/workspace/example/src/leaking.tsx",
          line: 4,
          code: 'window.addEventListener("resize", resize)',
          message: "Event listener has no matching removal in its containing scope.",
          suggestion: "Return a matching cleanup function.",
        },
      ],
      diagnostics: [],
    },
  ],
  issues: [],
  diagnostics: [],
  totals: {
    files: 2,
    issues: 1,
    high: 1,
    medium: 0,
    low: 0,
    parseErrors: 0,
    readErrors: 0,
  },
  durationMs: 5,
};
analysis.issues = analysis.files.flatMap((file) => file.issues);

test("Analyzer dashboard renders responsively, navigates, filters, and returns to the launcher", async () => {
  const setup = await createTestRenderer({ width: 110, height: 28 });
  let wentBack = false;
  const dashboard = createAnalyzerDashboard(setup.renderer, analysis, {
    onBack: () => {
      wentBack = true;
    },
  });

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();
    const brand = dashboard.root.findDescendantById("analyzer-brand") as TextRenderable;
    const summary = dashboard.root.findDescendantById("analyzer-summary") as TextRenderable;
    const filterRow = dashboard.root.findDescendantById("analyzer-filter-row") as BoxRenderable;

    expect(frame).toContain("Analyzer");
    expect(frame).toContain("2 🅵");
    expect(frame).toContain("1 issues");
    expect(frame).toContain("src/clean.ts");
    expect(frame).toContain("High");
    expect(frame).toContain("Esc/b");
    expect(brand.y).toBe(summary.y);
    expect(summary.y).toBe(filterRow.y);
    expect(Math.abs(summary.x + summary.width / 2 - setup.renderer.terminalWidth / 2)).toBeLessThanOrEqual(1);

    setup.mockInput.pressArrow("down");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("Event Listener Leak");
    expect(frame).toContain("Event listener has no matching removal");

    dashboard.filterInput.focus();
    await setup.mockInput.typeText("leaking");
    await setup.flush();
    expect(dashboard.filterInput.value).toBe("leaking");
    expect(setup.captureCharFrame()).not.toContain("src/clean.ts");

    setup.resize(80, 28);
    await setup.flush();
    expect(summary.y).toBeGreaterThan(brand.y);
    expect(filterRow.y).toBeGreaterThan(summary.y);

    dashboard.fileList.focus();
    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});

test("Analyzer dashboard aborts an active rescan when disposed", async () => {
  const setup = await createTestRenderer({ width: 100, height: 24 });
  let aborted = false;
  const dashboard = createAnalyzerDashboard(setup.renderer, analysis, {
    onRescan: (signal) =>
      new Promise<CodeHealthAnalysis>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(signal.reason);
        });
      }),
  });

  setup.mockInput.pressKey("r");
  await setup.flush();
  dashboard.dispose();
  await setup.flush();
  expect(aborted).toBe(true);
  setup.renderer.destroy();
});
