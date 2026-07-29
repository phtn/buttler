import { describe, expect, test } from "bun:test";
import { parseCliArgs, usage, VERSION } from "../core";
import {
  isGitHubUrl,
  normalizeGitHubUrl,
} from "../utils/github";

describe("CLI argument parsing", () => {
  test("uses the current directory and automatic output by default", () => {
    expect(parseCliArgs([])).toEqual({
      target: ".",
      mode: "auto",
      exclude: [],
      check: false,
      help: false,
      version: false,
    });
  });

  test("supports output, check, and repeatable exclusion options", () => {
    expect(
      parseCliArgs([
        "./src",
        "--json",
        "--check",
        "--exclude",
        "fixtures,generated",
        "--exclude=vendor",
      ]),
    ).toEqual({
      target: "./src",
      mode: "json",
      exclude: ["fixtures", "generated", "vendor"],
      check: true,
      help: false,
      version: false,
    });
  });

  test("rejects conflicting output modes and unknown flags", () => {
    expect(() => parseCliArgs(["--json", "--plain"])).toThrow("conflict");
    expect(() => parseCliArgs(["--wat"])).toThrow("Unknown option");
  });

  test("keeps help and version output synchronized", () => {
    expect(usage()).toContain(`buttler ${VERSION}`);
    expect(usage()).toContain("--plain");
    expect(usage()).toContain("r rescan");
  });
});

describe("GitHub URL handling", () => {
  test("accepts HTTPS and SSH repository URLs", () => {
    expect(isGitHubUrl("https://github.com/openai/codex")).toBe(true);
    expect(isGitHubUrl("git@github.com:openai/codex.git")).toBe(true);
    expect(isGitHubUrl("https://example.com/openai/codex")).toBe(false);
  });

  test("normalizes repository subpaths without invoking a shell", () => {
    expect(
      normalizeGitHubUrl(
        "https://github.com/openai/codex/tree/main/packages/example",
      ),
    ).toBe("https://github.com/openai/codex.git");
    expect(normalizeGitHubUrl("git@github.com:openai/codex.git")).toBe(
      "https://github.com/openai/codex.git",
    );
  });
});
