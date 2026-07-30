#!/usr/bin/env bun

import {
  analyzeProject,
  parseCliArgs,
  usage,
  VERSION,
  type OutputMode,
} from "./core";
import { runInteractiveToolbox } from "./ui/launcher";
import { formatPlainReport } from "./ui/table";
import { cleanupTempDir } from "./utils/helpers";
import { cloneGitHubRepo, isGitHubUrl } from "./utils/github";

interface PreparedTarget {
  path: string;
  cleanup?: () => Promise<void>;
}

async function prepareTarget(target: string): Promise<PreparedTarget> {
  if (!isGitHubUrl(target)) return { path: target };

  const directory = await cloneGitHubRepo(target);
  return {
    path: directory,
    cleanup: () => cleanupTempDir(directory),
  };
}

function resolveMode(
  requestedMode: OutputMode,
  check: boolean,
): Exclude<OutputMode, "auto"> {
  if (requestedMode !== "auto") return requestedMode;
  if (check) return "plain";
  return process.stdin.isTTY && process.stdout.isTTY
    ? "interactive"
    : "plain";
}

export async function main(args = Bun.argv.slice(2)): Promise<number> {
  let options;
  try {
    options = parseCliArgs(args);
  } catch (error) {
    process.stderr.write(
      `buttler: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`,
    );
    return 2;
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const mode = resolveMode(options.mode, options.check);
  if (
    mode === "interactive" &&
    (!process.stdin.isTTY || !process.stdout.isTTY)
  ) {
    process.stderr.write(
      "buttler: interactive mode requires a TTY; use --plain or --json.\n",
    );
    return 2;
  }
  if (mode === "interactive" && options.check) {
    process.stderr.write(
      "buttler: --check cannot be combined with interactive mode.\n",
    );
    return 2;
  }

  let prepared: PreparedTarget | undefined;
  try {
    prepared = await prepareTarget(options.target);

    if (mode === "interactive") {
      await runInteractiveToolbox(prepared.path, {
        exclude: options.exclude,
      });
      return 0;
    }

    const analysis = await analyzeProject(prepared.path, {
      exclude: options.exclude,
    });

    if (mode === "json") {
      process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatPlainReport(analysis)}\n`);
    }

    return options.check && analysis.diagnostics.length > 0 ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `buttler: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    if (prepared?.cleanup) {
      try {
        await prepared.cleanup();
      } catch (error) {
        process.stderr.write(
          `buttler: failed to clean temporary clone: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
      }
    }
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
