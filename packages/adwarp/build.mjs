#!/usr/bin/env node
/**
 * Builds the published `adwarp` npm package. Bundles the private @liads/*
 * workspace packages into dist/cli.js (the adwarp and liam commands) and
 * dist/mcp.js (adwarp-mcp), and leaves every third-party import as a real npm
 * dependency. Fails on an import that package.json does not declare, and when
 * the release version in package.json, @liads/shared and server.json disagree.
 *
 * Runs after the workspace build: `pnpm -r build` orders it after its
 * @liads/* devDependencies.
 */
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { VERSION } from "@liads/shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const REPO_URL = "https://github.com/adwarp-dev/adwarp";

const pkg = JSON.parse(await readFile(join(HERE, "package.json"), "utf8"));
const server = JSON.parse(await readFile(join(ROOT, "server.json"), "utf8"));
const versions = {
  "packages/adwarp/package.json": pkg.version,
  "packages/shared/src/version.ts": VERSION,
  "server.json version": server.version,
  "server.json npm package version": server.packages.find((p) => p.identifier === pkg.name)?.version,
};
if (new Set(Object.values(versions)).size !== 1) {
  const list = Object.entries(versions).map(([where, v]) => `${where}: ${v}`).join(", ");
  throw new Error(`Release versions disagree (${list}). Run \`pnpm set-version <x.y.z>\` from the repo root.`);
}
if (pkg.mcpName !== server.name) {
  throw new Error(`mcpName in packages/adwarp/package.json (${pkg.mcpName}) must equal the name in server.json (${server.name}).`);
}

const dependencies = new Set(Object.keys(pkg.dependencies));
const builtins = new Set(builtinModules);

/** "@scope/name/sub/path" -> "@scope/name", "name/sub" -> "name". */
function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** Bundles @liads/*, keeps declared dependencies external, and refuses anything undeclared. */
const dependencyGuard = {
  name: "dependency-guard",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("node:") || builtins.has(args.path)) return { external: true };
      if (args.path.startsWith("@liads/")) return undefined;
      if (dependencies.has(packageName(args.path))) return { external: true };
      return {
        errors: [
          { text: `${packageName(args.path)} is imported by ${args.importer} but is not in packages/adwarp/package.json dependencies` },
        ],
      };
    });
  },
};

await rm(join(HERE, "dist"), { recursive: true, force: true });
await build({
  entryPoints: {
    cli: join(ROOT, "packages", "cli", "dist", "index.js"),
    mcp: join(ROOT, "packages", "mcp", "dist", "index.js"),
  },
  outdir: join(HERE, "dist"),
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  chunkNames: "chunks/[name]-[hash]",
  plugins: [dependencyGuard],
  logLevel: "warning",
});

// npm shows the package README, so ship the repo README with its relative links
// pointed at GitHub, plus the license.
const readme = await readFile(join(ROOT, "README.md"), "utf8");
await writeFile(
  join(HERE, "README.md"),
  readme.replace(/\]\((?:\.\/)?(?!https?:|#|mailto:)([^)\s]+)\)/g, `](${REPO_URL}/blob/main/$1)`),
);
await copyFile(join(ROOT, "LICENSE"), join(HERE, "LICENSE"));
