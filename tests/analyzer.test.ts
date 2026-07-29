import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeProject } from "../core";

const temporaryDirectories: string[] = [];

async function fixture(
  files: Record<string, string>,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "buttler-test-"));
  temporaryDirectories.push(root);

  await Promise.all(
    Object.entries(files).map(async ([fileName, contents]) => {
      const filePath = path.join(root, fileName);
      await Bun.write(filePath, contents, { createPath: true });
    }),
  );

  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("analyzeProject", () => {
  test("counts imports and exports and reports actionable diagnostics", async () => {
    const root = await fixture({
      "source.ts": `
        export const used = 1
        export const unused = 2
        export default function greet() {}
      `,
      "consumer.ts": `
        import greet, { used } from "./source.js"
        console.log(greet, used)
      `,
      "broken-import.ts": `
        import { missing } from "./missing"
        console.log(missing)
      `,
    });

    const analysis = await analyzeProject(root);
    const source = analysis.files.find((file) => file.path === "source.ts");
    const consumer = analysis.files.find(
      (file) => file.path === "consumer.ts",
    );

    expect(analysis.totals.files).toBe(3);
    expect(consumer?.imports.map((item) => item.imported)).toEqual([
      "default",
      "used",
    ]);
    expect(source?.exports.map((item) => item.name)).toEqual([
      "used",
      "unused",
      "default",
    ]);
    expect(analysis.unusedExports).toEqual([
      expect.objectContaining({ file: "source.ts", name: "unused" }),
    ]);
    expect(analysis.totals.unresolvedImports).toBe(1);
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "UNRESOLVED_IMPORT",
        file: "broken-import.ts",
      }),
    );
  });

  test("follows named and star re-exports before classifying usage", async () => {
    const root = await fixture({
      "source.ts": `export const direct = 1; export const starred = 2`,
      "named.ts": `export { direct as renamed } from "./source"`,
      "star.ts": `export * from "./source"`,
      "consumer.ts": `
        import { renamed } from "./named"
        import { starred } from "./star"
        console.log(renamed, starred)
      `,
    });

    const analysis = await analyzeProject(root);

    expect(analysis.unusedExports).toEqual([]);
    expect(analysis.totals.unresolvedImports).toBe(0);
  });

  test("does not treat default exports as part of export-star", async () => {
    const root = await fixture({
      "source.ts": `
        export default function hiddenDefault() {}
        export const visible = true
      `,
      "barrel.ts": `export * from "./source"`,
      "consumer.ts": `import * as api from "./barrel"; console.log(api.visible)`,
    });

    const analysis = await analyzeProject(root);

    expect(analysis.unusedExports).toEqual([
      expect.objectContaining({ file: "source.ts", name: "default" }),
    ]);
  });

  test("recognizes CommonJS imports and exports", async () => {
    const root = await fixture({
      "source.cjs": `
        module.exports.foo = 1
        exports.bar = 2
        module.exports = { baz: 3 }
      `,
      "consumer.cjs": `
        const { foo } = require("./source.cjs")
        console.log(foo)
      `,
    });

    const analysis = await analyzeProject(root);
    const source = analysis.files.find((file) => file.path === "source.cjs");
    const consumer = analysis.files.find(
      (file) => file.path === "consumer.cjs",
    );

    expect(source?.exports.map((item) => item.name)).toEqual([
      "foo",
      "bar",
      "default",
    ]);
    expect(consumer?.imports).toContainEqual(
      expect.objectContaining({ imported: "foo", local: "foo" }),
    );
    expect(analysis.unusedExports.map((item) => item.name)).toEqual([
      "bar",
      "default",
    ]);
  });

  test("keeps side-effect and non-code asset imports out of false positives", async () => {
    const root = await fixture({
      "source.ts": `export const untouched = true`,
      "consumer.ts": `
        require("./source")
        import "./styles.css"
      `,
      "styles.css": `body { color: teal }`,
    });

    const analysis = await analyzeProject(root);
    const consumer = analysis.files.find(
      (file) => file.path === "consumer.ts",
    );

    expect(consumer?.imports).toContainEqual(
      expect.objectContaining({
        source: "./source",
        kind: "side-effect",
      }),
    );
    expect(analysis.totals.unresolvedImports).toBe(0);
    expect(analysis.unusedExports).toContainEqual(
      expect.objectContaining({ name: "untouched" }),
    );
  });

  test("records parse failures without aborting the project scan", async () => {
    const root = await fixture({
      "good.ts": `export interface User { id: string }`,
      "broken.ts": `export const =`,
    });

    const analysis = await analyzeProject(root);

    expect(analysis.totals.files).toBe(2);
    expect(analysis.totals.parseErrors).toBe(1);
    expect(analysis.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "PARSE_ERROR",
        file: "broken.ts",
      }),
    );
  });

  test("honors additional excluded directory names", async () => {
    const root = await fixture({
      "src/index.ts": `export const included = true`,
      "generated/output.ts": `export const ignored = true`,
    });

    const analysis = await analyzeProject(root, {
      exclude: ["generated"],
    });

    expect(analysis.files.map((file) => file.path)).toEqual([
      "src/index.ts",
    ]);
  });
});
