#!/usr/bin/env node
/**
 * Smoke test for what users actually install. Two modes:
 *
 *   node scripts/smoke.mjs <adwarp-x.y.z.tgz>   the packed npm package
 *   node scripts/smoke.mjs --docker <image>      the root Dockerfile's image
 *
 * The tarball mode installs into an empty folder with an empty npm cache and an
 * empty HOME, runs `npx adwarp --help` against it, checks the adwarp and liam
 * commands report the package version, and connects to both `adwarp-mcp` and
 * `adwarp mcp`. Every MCP check expects exactly the tools in docs/tools.json.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const TIMEOUT_MS = 60_000;

const pkg = JSON.parse(await readFile(join(HERE, "..", "package.json"), "utf8"));
const expectedTools = JSON.parse(await readFile(join(ROOT, "docs", "tools.json"), "utf8"))
  .map((t) => t.name)
  .sort();

/** The caller's environment minus any Adwarp credentials, with HOME pointed at an empty folder. */
function cleanEnv(home, extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("LIADS_") && !k.startsWith("GADS_")),
  );
  return { ...env, HOME: home, USERPROFILE: home, ...extra };
}

function run(command, args, env) {
  return execFileSync(command, args, { env, encoding: "utf8", timeout: TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] });
}

function check(ok, message) {
  if (!ok) throw new Error(message);
  console.log(`ok  ${message}`);
}

/** Connects over stdio and checks the server's version and its full tool list. */
async function checkMcp(label, command, args, env) {
  const client = new Client({ name: "adwarp-smoke", version: pkg.version });
  const transport = new StdioClientTransport({ command, args, env, stderr: "inherit" });
  const timer = setTimeout(() => {
    console.error(`${label}: no MCP response within ${TIMEOUT_MS / 1000}s`);
    process.exit(1);
  }, TIMEOUT_MS);
  try {
    await client.connect(transport);
    const info = client.getServerVersion();
    check(info?.name === "adwarp" && info.version === pkg.version, `${label} reports adwarp ${pkg.version}`);
    const names = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      names.push(...page.tools.map((t) => t.name));
      cursor = page.nextCursor;
    } while (cursor);
    names.sort();
    const missing = expectedTools.filter((n) => !names.includes(n));
    const extra = names.filter((n) => !expectedTools.includes(n));
    check(
      missing.length === 0 && extra.length === 0,
      `${label} lists the ${expectedTools.length} tools in docs/tools.json` +
        (missing.length || extra.length ? ` (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})` : ""),
    );
  } finally {
    clearTimeout(timer);
    await client.close();
  }
}

async function smokeTarball(tarball) {
  const work = await mkdtemp(join(tmpdir(), "adwarp-smoke-"));
  const home = join(work, "home");
  const app = join(work, "app");
  await mkdir(home);
  await mkdir(app);
  const env = cleanEnv(home, { npm_config_cache: join(work, "npm-cache"), npm_config_update_notifier: "false" });

  const help = run("npx", ["--yes", "--package", tarball, "--", "adwarp", "--help"], env);
  check(help.includes("Usage: adwarp") && /^\s+mcp\b/m.test(help), "npx adwarp --help runs from a clean cache and lists the mcp command");

  run("npm", ["install", "--prefix", app, "--no-audit", "--no-fund", tarball], env);
  const bin = (name) => join(app, "node_modules", ".bin", name);
  check(run(bin("adwarp"), ["--version"], env).trim() === pkg.version, `adwarp --version prints ${pkg.version}`);
  check(run(bin("liam"), ["--version"], env).trim() === pkg.version, `liam --version prints ${pkg.version}`);

  await checkMcp("adwarp-mcp", bin("adwarp-mcp"), [], env);
  await checkMcp("adwarp mcp", bin("adwarp"), ["mcp"], env);
}

async function smokeDocker(image) {
  const env = cleanEnv(process.env.HOME ?? tmpdir());
  check(
    run("docker", ["run", "--rm", "--entrypoint", "adwarp", image, "--version"], env).trim() === pkg.version,
    `the image's adwarp --version prints ${pkg.version}`,
  );
  await checkMcp("docker run -i", "docker", ["run", "-i", "--rm", image], env);
}

const args = process.argv.slice(2);
if (args[0] === "--docker" && args[1]) {
  await smokeDocker(args[1]);
} else if (args.length === 1 && args[0].endsWith(".tgz")) {
  await smokeTarball(resolve(args[0]));
} else {
  console.error("Usage: node scripts/smoke.mjs <adwarp-x.y.z.tgz> | --docker <image>");
  process.exit(2);
}
