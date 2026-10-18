import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Files whose presence means a folder holds a real install. */
const INSTALL_FILES = ["config.json", "credentials.json", "google.json", "google-credentials.json"];

/**
 * The one directory holding every credential and local artifact Adwarp writes,
 * for every ad platform it talks to. New installs use ~/.adwarp. An install from
 * before the rename keeps using ~/.liads until ~/.adwarp holds config or
 * credentials of its own, so stored logins and the change journal stay where they
 * are, and an empty ~/.adwarp never hides them. Platform-specific files live
 * inside it under distinct names.
 */
export const ADWARP_DIR = resolveAdwarpDir();

function resolveAdwarpDir(): string {
  const current = join(homedir(), ".adwarp");
  const legacy = join(homedir(), ".liads");
  const holdsInstall = (dir: string) => INSTALL_FILES.some((file) => existsSync(join(dir, file)));
  if (holdsInstall(current) || !existsSync(legacy)) return current;
  return legacy;
}

/** A path under the home directory written as ~/..., for messages. */
export function displayPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
