import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
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

test("OpenTUI dashboard renders, navigates, and filters", async () => {
  const setup = await createTestRenderer({ width: 110, height: 28 });
  const dashboard = createDiagnosisDashboard(setup.renderer, analysis);

  try {
    await setup.flush();
    let frame = setup.captureCharFrame();

    expect(frame).toContain("BUTTLER");
    expect(frame).toContain("CODE DIAGNOSIS");
    expect(frame).toContain("File");
    expect(frame).toContain("Imports");
    expect(frame).toContain("src/alpha.ts");
    expect(frame).toContain("Unused exports");

    setup.mockInput.pressArrow("down");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("1 imports  ·  0 exports");

    dashboard.filterInput.focus();
    await setup.mockInput.typeText("beta");
    await setup.flush();
    frame = setup.captureCharFrame();
    expect(frame).toContain("src/beta.ts");
    expect(frame).toContain("FILTER");
  } finally {
    dashboard.dispose();
    setup.renderer.destroy();
  }
});
