/**
 * The Adwarp rename keeps every pre-rename name working: LIADS_* environment
 * variables, X-Liads-* request headers, and the ~/.liads folder. These pin that
 * promise, and that the new names win when both are present.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { loadConfig, requestCredentialsFromHeaders } = await import("../dist/index.js");
const SHARED = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "shared", "dist", "index.js")).href;
const { env } = await import(SHARED);

/** Runs fn with exactly these Adwarp-related env vars set, restoring the rest after. */
async function withEnv(vars, fn) {
  const names = Object.keys(process.env).filter((k) => /^(ADWARP|LIADS|GADS)_/.test(k));
  const saved = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  for (const k of names) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(process.env)) if (/^(ADWARP|LIADS|GADS)_/.test(k)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

test("env() reads the new name, falls back to the old one, and ignores empty values", async () => {
  await withEnv({ LIADS_CLIENT_ID: "old" }, () => assert.equal(env("ADWARP_LINKEDIN_CLIENT_ID"), "old"));
  await withEnv({ LIADS_CLIENT_ID: "old", ADWARP_LINKEDIN_CLIENT_ID: "new" }, () =>
    assert.equal(env("ADWARP_LINKEDIN_CLIENT_ID"), "new"),
  );
  await withEnv({ LIADS_CLIENT_ID: "old", ADWARP_LINKEDIN_CLIENT_ID: "" }, () =>
    assert.equal(env("ADWARP_LINKEDIN_CLIENT_ID"), "old"),
  );
  await withEnv({ GADS_DEVELOPER_TOKEN: "old" }, () => assert.equal(env("ADWARP_GOOGLE_DEVELOPER_TOKEN"), "old"));
  await withEnv({}, () => assert.equal(env("ADWARP_NO_CHANGELOG"), undefined));
});

test("loadConfig accepts LIADS_* env vars from before the rename", async () => {
  const config = await withEnv(
    { LIADS_CLIENT_ID: "id", LIADS_CLIENT_SECRET: "secret", LIADS_DEFAULT_ACCOUNT_ID: "123", LIADS_LINKEDIN_VERSION: "202605" },
    () => loadConfig(),
  );
  assert.deepEqual(config, { clientId: "id", clientSecret: "secret", defaultAccountId: "123", linkedinVersion: "202605" });
});

test("credential headers: new names, old X-Liads-* names, and new over old", () => {
  const headers = (h) => new Headers(h);
  const fresh = requestCredentialsFromHeaders(
    headers({
      "X-Adwarp-Linkedin-Client-Id": "id",
      "X-Adwarp-Linkedin-Client-Secret": "secret",
      "X-Adwarp-Linkedin-Refresh-Token": "refresh",
      "X-Adwarp-Linkedin-Account-Id": "123",
    }),
  );
  assert.deepEqual(fresh, { clientId: "id", clientSecret: "secret", refreshToken: "refresh", defaultAccountId: "123", linkedinVersion: undefined });

  const legacy = requestCredentialsFromHeaders(
    headers({
      "X-Liads-Client-Id": "id",
      "X-Liads-Client-Secret": "secret",
      "X-Liads-Refresh-Token": "refresh",
      "X-Liads-Linkedin-Version": "202605",
    }),
  );
  assert.deepEqual(legacy, { clientId: "id", clientSecret: "secret", refreshToken: "refresh", defaultAccountId: undefined, linkedinVersion: "202605" });

  const both = requestCredentialsFromHeaders(
    headers({
      "X-Adwarp-Linkedin-Client-Id": "new",
      "X-Liads-Client-Id": "old",
      "X-Liads-Client-Secret": "secret",
      "X-Liads-Refresh-Token": "refresh",
    }),
  );
  assert.equal(both?.clientId, "new");

  assert.equal(requestCredentialsFromHeaders(headers({ "X-Liads-Client-Id": "id", "X-Liads-Client-Secret": "secret" })), null);
});

test("the Adwarp folder is ~/.adwarp, except on installs that only have ~/.liads", () => {
  const dirFor = (folders, files = []) => {
    const home = mkdtempSync(join(tmpdir(), "adwarp-home-"));
    for (const f of folders) mkdirSync(join(home, f));
    for (const f of files) writeFileSync(join(home, f), "{}");
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(SHARED)}); console.log(m.ADWARP_DIR);`], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      encoding: "utf8",
    });
    return out.trim().slice(home.length);
  };
  assert.match(dirFor([]), /[\\/]\.adwarp$/);
  assert.match(dirFor([".adwarp"]), /[\\/]\.adwarp$/);
  assert.match(dirFor([".liads"], [".liads/config.json"]), /[\\/]\.liads$/);
  // An empty or unrelated ~/.adwarp must not hide a working ~/.liads install.
  assert.match(dirFor([".liads", ".adwarp"], [".liads/config.json", ".adwarp/docker.env"]), /[\\/]\.liads$/);
  // Once ~/.adwarp holds an install of its own, it wins.
  assert.match(dirFor([".liads", ".adwarp"], [".liads/config.json", ".adwarp/config.json"]), /[\\/]\.adwarp$/);
  assert.match(dirFor([".liads", ".adwarp"], [".adwarp/google-credentials.json"]), /[\\/]\.adwarp$/);
});
