import * as path from "node:path";

/** Rejects absolute paths copied from a different operating system. */
export function isNativeAbsolutePath(
  value: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    return path.posix.isAbsolute(value);
  }

  if (!path.win32.isAbsolute(value)) {
    return false;
  }
  const root = path.win32.parse(value).root;
  return root !== "\\" && root !== "/";
}
