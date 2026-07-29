# buttler

Buttler is an interactive code-diagnosis CLI for JavaScript and TypeScript
projects. It scans static imports, CommonJS `require` calls, exports,
re-exports, unresolved local modules, parse failures, and unused export
candidates.

The terminal dashboard is built on the official
[OpenTUI](https://opentui.com/) renderer and runs with Bun.

## Install

```sh
bun install
```

## Run

Open the interactive dashboard for the current project:

```sh
bun run index.ts
```

Scan another directory, one source file, or a public GitHub repository:

```sh
bun run index.ts ./src
bun run index.ts ./src/index.ts
bun run index.ts https://github.com/owner/repository
```

The dashboard supports:

- `↑` / `↓` to select a file
- `/` to focus the live file filter
- `Esc` to clear the filter
- `r` to rescan the project
- `q` or `Ctrl-C` to quit

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
