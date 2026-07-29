import { describe, expect, test } from "bun:test";
import type { ProjectAnalysis } from "../core";
import {
  formatAnalysisTable,
  formatPlainReport,
  getVisualWidth,
  padToVisualWidth,
  truncateToVisualWidth,
} from "../ui/table";

const analysis: ProjectAnalysis = {
  root: "/project",
  files: [
    {
      absolutePath: "/project/src/index.ts",
      path: "src/index.ts",
      imports: [],
      exports: [
        {
          name: "run",
          local: "run",
          kind: "named",
          typeOnly: false,
        },
      ],
      reexports: [],
      diagnostics: [],
    },
  ],
  diagnostics: [],
  unusedExports: [
    {
      file: "src/index.ts",
      name: "run",
      typeOnly: false,
    },
  ],
  totals: {
    files: 1,
    imports: 0,
    exports: 1,
    unusedExports: 1,
    unresolvedImports: 0,
    parseErrors: 0,
    errors: 0,
    warnings: 1,
  },
  durationMs: 4,
};

describe("table formatting", () => {
  test("produces the requested file/import/export report", () => {
    const lines = formatAnalysisTable(analysis).split("\n");

    expect(lines[0]).toContain("File");
    expect(lines[0]).toContain("Imports");
    expect(lines[0]).toContain("Exports");
    expect(lines[2]).toContain("src/index.ts");
    expect(lines[2]?.trimEnd()).toEndWith("1");
    expect(lines[3]).toContain("Unused exports");
    expect(lines[3]?.trimEnd()).toEndWith("1");
    expect(lines.every((line) => getVisualWidth(line) === 55)).toBe(true);
  });

  test("truncates and aligns cells deterministically", () => {
    expect(truncateToVisualWidth("abcdefgh", 5)).toBe("abcd…");
    expect(padToVisualWidth("2", 5, "center")).toBe("  2  ");
    expect(padToVisualWidth("abc", 5, "right")).toBe("  abc");
  });

  test("includes a compact machine-readable summary line", () => {
    expect(formatPlainReport(analysis)).toEndWith(
      "1 files · 0 imports · 1 exports · 1 unused · 0 unresolved · 0 parse errors · 4ms",
    );
  });
});
