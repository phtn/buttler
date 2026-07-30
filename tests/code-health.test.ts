import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyzeCodeHealth,
  analyzeCodeHealthSource,
  type CodeHealthIssueType,
} from "../core";

function issueTypes(source: string): CodeHealthIssueType[] {
  return analyzeCodeHealthSource(source, "/workspace/example.tsx", "/workspace").issues.map(
    (issue) => issue.type,
  );
}

test("code health matches listener and timer cleanup by identity", () => {
  const types = issueTypes(`
    function Clean() {
      useEffect(() => {
        const onResize = () => {};
        window.addEventListener("resize", onResize);
        const timer = setInterval(tick, 1000);
        return () => {
          window.removeEventListener("resize", onResize);
          clearInterval(timer);
        };
      }, []);
      return <main />;
    }
  `);

  expect(types).not.toContain("event-listener-leak");
  expect(types).not.toContain("timer-leak");
  expect(types).not.toContain("use-effect-cleanup");

  const leaking = issueTypes(`
    function Leaking() {
      useEffect(() => {
        window.addEventListener("resize", onResize);
        setTimeout(tick, 1000);
      }, []);
      return <main />;
    }
  `);
  expect(leaking).toContain("event-listener-leak");
  expect(leaking).toContain("timer-leak");
  expect(leaking).toContain("use-effect-cleanup");
});

test("code health finds hooks, mutation, globals, and DOM references", () => {
  const types = issueTypes(`
    globalThis.cache = new Map();
    function Profile() {
      useEffect(() => document.querySelector("#profile"));
      useEffect(() => {}, [{}]);
      userState.items.push("x");
      state.name = "Ada";
      return <section />;
    }
  `);

  expect(types).toContain("global-object");
  expect(types).toContain("missing-dependencies");
  expect(types).toContain("infinite-render");
  expect(types).toContain("state-mutation");
  expect(types).toContain("dom-reference");
  expect(issueTypes("useMemo(() => calculate()); useCallback(() => save());").filter((type) => type === "missing-dependencies")).toHaveLength(2);
});

test("code health recognizes arrow components and expensive JSX operations", () => {
  const result = analyzeCodeHealthSource(
    `
      import moment from "moment";
      const Results = ({ items }) => <ul>{items.map(item => <li>{item}</li>)}</ul>;
      const Stable = memo(() => <aside />);
      function decide(value) {
        if (value === 1) return 1;
        if (value === 2) return 2;
        if (value === 3) return 3;
        if (value === 4) return 4;
        if (value === 5) return 5;
        if (value === 6) return 6;
        if (value === 7) return 7;
        if (value === 8) return 8;
        if (value === 9) return 9;
        if (value === 10) return 10;
        return value ? 11 : 12;
      }
    `,
    "/workspace/components.tsx",
    "/workspace",
  );

  expect(result.issues.some((issue) => issue.type === "component-re-render" && issue.message.includes("Results"))).toBe(
    true,
  );
  expect(result.issues.some((issue) => issue.type === "component-re-render" && issue.message.includes("Stable"))).toBe(
    false,
  );
  expect(result.issues.map((issue) => issue.type)).toContain("expensive-jsx-operation");
  expect(result.issues.map((issue) => issue.type)).toContain("bundle-size-issue");
  expect(result.issues.map((issue) => issue.type)).toContain("high-complexity-function");
});

test("project analysis reports progress, parse errors, exclusions, and cancellation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "buttler-health-"));
  try {
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "generated"));
    await writeFile(path.join(root, "src", "good.ts"), "const timer = setTimeout(run, 10);\n");
    await writeFile(path.join(root, "src", "broken.ts"), "const = ;\n");
    await writeFile(path.join(root, "generated", "ignored.ts"), "setInterval(run, 10);\n");

    const progress: string[] = [];
    const analysis = await analyzeCodeHealth(root, {
      exclude: ["generated"],
      onProgress: ({ file }) => progress.push(file),
    });

    expect(analysis.totals.files).toBe(2);
    expect(analysis.totals.parseErrors).toBe(1);
    expect(analysis.totals.high).toBe(1);
    expect(progress).toHaveLength(2);
    expect(analysis.files.some((file) => file.path.includes("generated"))).toBe(false);

    const controller = new AbortController();
    controller.abort();
    await expect(analyzeCodeHealth(root, { signal: controller.signal })).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
