import { cleanupTempDir, createTempDir } from "./helpers";

const GITHUB_SSH_PATTERN =
  /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;

export function isGitHubUrl(input: string): boolean {
  if (GITHUB_SSH_PATTERN.test(input)) return true;

  try {
    const url = new URL(input);
    const segments = url.pathname.split("/").filter(Boolean);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "github.com" &&
      segments.length >= 2
    );
  } catch {
    return false;
  }
}

export function normalizeGitHubUrl(input: string): string {
  const sshMatch = GITHUB_SSH_PATTERN.exec(input);
  if (sshMatch) {
    return `https://github.com/${sshMatch[1]}/${sshMatch[2]}.git`;
  }

  const url = new URL(input);
  if (url.hostname.toLowerCase() !== "github.com") {
    throw new Error("Only github.com repository URLs are supported.");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const owner = segments[0];
  const repository = segments[1]?.replace(/\.git$/i, "");
  if (!owner || !repository) {
    throw new Error(`Invalid GitHub repository URL: ${input}`);
  }

  return `https://github.com/${owner}/${repository}.git`;
}

export async function cloneGitHubRepo(repoUrl: string): Promise<string> {
  const directory = await createTempDir("buttler-repo-");
  const normalizedUrl = normalizeGitHubUrl(repoUrl);

  try {
    const child = Bun.spawn(
      ["git", "clone", "--depth", "1", "--quiet", normalizedUrl, directory],
      {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(
        stderr.trim() || `git clone exited with status ${exitCode}`,
      );
    }

    return directory;
  } catch (error) {
    await cleanupTempDir(directory);
    throw new Error(
      `Failed to clone ${normalizedUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
