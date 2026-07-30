---
project: buttler
description: project-wide developer toolbox
timestamp: timestamp ⸬ Thu Jul 30, 2026  00:50:38 am - +08:00
---

Buttler is an interactive toolbox for JavaScript and TypeScript projects.
Morti is a code mortician that scans static imports, CommonJS
`require` calls, exports, re-exports, unresolved local modules, parse failures,
and unused export candidates to help identify dead code.

Analyzer scans source code for risky memory, lifecycle, React, complexity, and
bundle-size patterns. It runs directly in TypeScript, so it does not require a
Rust toolchain or launch a subprocess during a scan.

The terminal dashboard is built on the official
[OpenTUI](https://opentui.com/) renderer and runs with Bun.

## Install

```sh
bun install
```

## Run

Open the interactive tool selector for the current project:

```sh
bun run index.ts
```

Scan another directory, one source file, or a public GitHub repository:

```sh
bun run index.ts ./src
bun run index.ts ./src/index.ts
bun run index.ts https://github.com/owner/repository
```

The tool selector supports:

- Arrow keys or `h`, `j`, `k`, `l` to navigate tools
- `Enter` to launch the selected tool
- `q` or `Ctrl-C` to quit

Inside Morti:

- `↑` / `↓` to select a file
- `/` to focus the live file filter
- `Esc` to clear a focused filter, or return to the tool selector otherwise
- `b` to return to the tool selector when the filter is not focused
- `r` to rescan the project
- `q` or `Ctrl-C` to quit

Analyzer uses the same navigation, filter, rescan, back, and quit shortcuts.
Its file table groups findings by high, medium, and low severity, with the
selected file's evidence and suggested action shown in the details panel.

## Script-friendly output

Print the compact table:

```sh
bun run index.ts . --plain
```

Emit structured output:

```sh
bun run index.ts . --json
```

Use `--check` to exit with status `1` when any diagnostic is present:

```sh
bun run index.ts ./src --plain --check
```

Additional directory names can be excluded with a repeatable or
comma-separated option:

```sh
bun run index.ts . --exclude fixtures,generated --exclude vendor
```

## Development

```sh
bun run check
bun test
```

Build a standalone executable for the current operating system and
architecture:

```sh
bun run build
./dist/buttler
```

Unused exports are static-analysis candidates. Imports made by external
consumers and runtime-computed module paths cannot be inferred.
