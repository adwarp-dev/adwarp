#!/usr/bin/env node
/**
 * Sets the release version everywhere it lives: packages/adwarp/package.json,
 * packages/shared/src/version.ts, and both versions in server.json.
 *
 *   pnpm set-version 0.3.0
 *
 * Then open a PR, merge it, and push the tag v0.3.0 to run the Release workflow.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: pnpm set-version <x.y.z>");
  process.exit(2);
}

async function editJson(path, edit) {
  const file = join(ROOT, path);
  const json = JSON.parse(await readFile(file, "utf8"));
  edit(json);
  await writeFile(file, JSON.stringify(json, null, 2) + "\n");
}

await editJson("packages/adwarp/package.json", (pkg) => {
  pkg.version = version;
});
await editJson("server.json", (server) => {
  server.version = version;
  for (const p of server.packages) if (p.identifier === "adwarp") p.version = version;
});

const versionTs = join(ROOT, "packages", "shared", "src", "version.ts");
const source = await readFile(versionTs, "utf8");
const updated = source.replace(/export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);
if (updated === source && !source.includes(`"${version}"`)) throw new Error(`No VERSION constant found in ${versionTs}`);
await writeFile(versionTs, updated);

console.log(`Set the release version to ${version}. Next: open a PR, merge it, then push the tag v${version}.`);
