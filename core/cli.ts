export const VERSION = "0.2.0";

export type OutputMode = "auto" | "interactive" | "plain" | "json";

export interface CliOptions {
  target: string;
  mode: OutputMode;
  exclude: string[];
  check: boolean;
  help: boolean;
  version: boolean;
}

function requireValue(
  args: string[],
  index: number,
  option: string,
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

export function parseCliArgs(args: string[]): CliOptions {
  const positional: string[] = [];
  const exclude: string[] = [];
  let mode: OutputMode = "auto";
  let check = false;
  let help = false;
  let version = false;
  let positionalOnly = false;

  const setMode = (nextMode: OutputMode): void => {
    if (mode !== "auto" && mode !== nextMode) {
      throw new Error(`Output modes --${mode} and --${nextMode} conflict.`);
    }
    mode = nextMode;
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;

    if (positionalOnly) {
      positional.push(argument);
      continue;
    }

    if (argument === "--") {
      positionalOnly = true;
    } else if (argument === "--plain" || argument === "--no-ui") {
      setMode("plain");
    } else if (argument === "--json") {
      setMode("json");
    } else if (argument === "--ui" || argument === "--interactive") {
      setMode("interactive");
    } else if (argument === "--check") {
      check = true;
    } else if (argument === "--exclude") {
      const value = requireValue(args, index, argument);
      exclude.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if (argument.startsWith("--exclude=")) {
      exclude.push(
        ...argument
          .slice("--exclude=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--version" || argument === "-v") {
      version = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      positional.push(argument);
    }
  }

  if (positional.length > 1) {
    throw new Error("Only one file, directory, or GitHub URL can be scanned.");
  }

  return {
    target: positional[0] ?? ".",
    mode,
    exclude: [...new Set(exclude)],
    check,
    help,
    version,
  };
}

export function usage(): string {
  return `buttler ${VERSION} — interactive developer toolbox

Usage
  buttler [path-or-github-url] [options]

Options
  --ui, --interactive   Force the OpenTUI dashboard
  --plain, --no-ui      Print the file/import/export table
  --json                Emit the complete analysis as JSON
  --check               Exit non-zero when diagnostics are found
  --exclude <names>     Skip comma-separated directory names (repeatable)
  -h, --help            Show this help
  -v, --version         Show the version

Interactive keys
  Toolbox  arrows or h/j/k/l navigate   Enter launch   q quit
  Morti    ↑/↓ navigate   / filter   r rescan   Esc/b back   q quit
  Analyzer ↑/↓ navigate   / filter   r rescan   Esc/b back   q quit
  Memory   Space pause   r reset   g force GC/sample   Esc/b back   q quit
  Kitty    ↑/↓ select   ←/→ adjust   Enter edit   s save   r reload   p path
  Alacritty ↑/↓ select   ←/→ adjust   Enter edit   s save   r reload   p path
  Herdr    ↑/↓ select   ←/→ adjust   Enter edit   s save   r reload   p path

Examples
  buttler
  buttler ./src
  buttler https://github.com/owner/repository
  buttler ./src --plain
  buttler . --json --check`;
}
