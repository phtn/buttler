import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { BoxRenderable, TextRenderable } from "@opentui/core";
import type { ProjectAnalysis } from "../core";
import { createDiagnosisDashboard } from "../ui/dashboard";

const analysis: ProjectAnalysis = {
  root: "/workspace/example",
  files: [
    {
      absolutePath: "/workspace/example/src/alpha.ts",
      path: "src/alpha.ts",
      imports: [],
      exports: [],
      reexports: [],
      diagnostics: [],
    },
    {
      absolutePath: "/workspace/example/src/beta.ts",
      path: "src/beta.ts",
      imports: [
        {
          source: "./alpha",
          imported: "alpha",
          local: "alpha",
          kind: "named",
          typeOnly: false,
        },
      ],
      exports: [],
      reexports: [],
      diagnostics: [],
    },
  ],
  diagnostics: [],
  unusedExports: [],
  totals: {
    files: 2,
    imports: 1,
    exports: 0,
    unusedExports: 0,
    unresolvedImports: 0,
    parseErrors: 0,
    errors: 0,
    warnings: 0,
  },
  durationMs: 3,
};

test("OpenTUI dashboard renders a responsive header, navigates, and filters", async () => {
  const setup = await createTestRenderer({ width: 110, height: 28 });
  let wentBack = false;
  const dashboard = createDiagnosisDashboard(setup.renderer, analysis, {
    onBack: () => {
      wentBack = true;
    },
  });

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();

    const brand = dashboard.root.findDescendantById("brand") as TextRenderable;
    const summary = dashboard.root.findDescendantById("summary") as TextRenderable;
    const filterRow = dashboard.root.findDescendantById("filter-row") as BoxRenderable;

    expect(frame).toContain("Morti");
    expect(frame).toContain("2 🅵");
    expect(frame).toContain("search");
    expect(frame).toContain("File");
    expect(frame).toContain("Imports");
    expect(frame).toContain("src/alpha.ts");
    expect(frame).toContain("Unused exports");
    expect(frame).toContain("Esc/b");
    expect(brand.y).toBe(summary.y);
    expect(summary.y).toBe(filterRow.y);
    expect(Math.abs(summary.x + summary.width / 2 - setup.renderer.terminalWidth / 2)).toBeLessThanOrEqual(1);

    setup.resize(80, 28);
    await setup.flush();
    expect(summary.y).toBeGreaterThan(brand.y);
    expect(filterRow.y).toBeGreaterThan(summary.y);

    setup.resize(110, 28);
    await setup.flush();

    setup.mockInput.pressKey("b");
    await setup.flush();
    expect(wentBack).toBe(true);

    setup.mockInput.pressArrow("down");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("1 imports  ·  0 exports");

    dashboard.filterInput.focus();
    await setup.mockInput.typeText("beta");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("src/beta.ts");
    expect(dashboard.filterInput.value).toBe("beta");
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});
