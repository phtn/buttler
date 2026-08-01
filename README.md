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

Memory watches the running Buttler process for sustained heap, RSS, and
external-memory growth. It reports a confidence-rated signal after collecting
enough baseline data; that signal is evidence to investigate with an inspector
or heap snapshot, not proof of a leak.

Kitty is a focused editor for the terminal's most useful color, font, cursor,
window, tab, and behavior settings. It reads the effective values from
`~/.config/kitty/kitty.conf` while preserving the rest of the file.

Alacritty is the same kind of editor for `~/.config/alacritty/alacritty.toml`,
covering a curated set of window, font, cursor, scrolling, selection, and color
settings.

Herdr edits `~/.config/herdr/config.toml`, covering its common theme, terminal,
update, UI, notification, session, worktree, remote, and experimental settings,
plus the complete standard keymap. User-defined `[[keys.command]]` blocks remain
intact.

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

- Developer tools and config editors are shown in separate categories
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

Inside Memory:

- `Space` pauses or resumes sampling
- `r` clears the samples and starts a fresh baseline
- `g` forces a Bun garbage collection and immediately samples again
- `Esc` or `b` returns to the tool selector; `q` quits

Inside Kitty:

- `↑` / `↓` selects a setting
- `←` / `→` adjusts numbers and predefined choices
- `Enter` edits an exact value
- `x` resets the selected setting to the underlying config value
- `s` saves, `r` reloads values from disk, and `p` edits the active config path
- `Esc` or `b` returns to the tool selector; `q` quits

Kitty changes are written as overrides in a clearly marked block at the end of
the config, so the original reference content stays intact. Saves are atomic,
refuse to overwrite a file changed by another process, and copy the previous
file to `kitty.conf.buttler.bak`. Kitty's default automatic config reload makes
saved settings visible in running terminals when that setting supports reload.

Inside Alacritty:

- `↑` / `↓` selects a setting
- `←` / `→` adjusts numbers and predefined choices
- `Enter` edits an exact value
- `x` resets the selected setting to the underlying config value
- `s` saves, `r` reloads values from disk, and `p` edits the active config path
- `Esc` or `b` returns to the tool selector; `q` quits

Alacritty changes are written directly into the TOML file while preserving the
rest of the config. Saves are atomic, refuse to overwrite a file changed by
another process, and copy the previous file to `alacritty.toml.buttler.bak`.

Inside Herdr:

- `↑` / `↓` selects a setting, including every standard keybinding
- `←` / `→` adjusts numbers and predefined choices
- `Enter` edits an exact value; keybindings accept arrays such as
  `["prefix+n", "ctrl+alt+n"]`
- `x` resets the selected setting to its saved value
- `s` saves, `r` reloads values from disk, and `p` edits the active config path
- `Esc` or `b` returns to the tool selector; `q` quits

Herdr changes preserve settings outside Buttler's editor as well as custom
`[[keys.command]]` tables. Saves are atomic, reject stale snapshots, and back up
the previous file to `config.toml.buttler.bak`. Apply saved changes from Herdr's
`reload config` menu item or with `herdr server reload-config`.

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
