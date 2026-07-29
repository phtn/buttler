import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempDir(prefix = "buttler-"): Promise<string> {
  const safePrefix = path.basename(prefix).replaceAll(path.sep, "-");
  return mkdtemp(path.join(os.tmpdir(), safePrefix));
}

export async function cleanupTempDir(directory: string): Promise<void> {
  const absoluteDirectory = path.resolve(directory);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, absoluteDirectory);

  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing to remove a non-temporary path: ${directory}`);
  }

  await rm(absoluteDirectory, { recursive: true, force: true });
}
