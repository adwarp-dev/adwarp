/**
 * Google Ads settings keep answering to their GADS_* names from before the
 * Adwarp rename, and the ADWARP_GOOGLE_* names win when both are set.
 *
 * Runs against dist (`pnpm --filter @adwarp/google build` first).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { loadGoogleConfig } = await import("../dist/index.js");

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

test("loadGoogleConfig accepts GADS_* env vars from before the rename", async () => {
  const config = await withEnv(
    { GADS_CLIENT_ID: "id", GADS_CLIENT_SECRET: "secret", GADS_DEVELOPER_TOKEN: "token", GADS_LOGIN_CUSTOMER_ID: "111" },
    () => loadGoogleConfig(),
  );
  assert.equal(config.clientId, "id");
  assert.equal(config.developerToken, "token");
  assert.equal(config.loginCustomerId, "111");
});

test("ADWARP_GOOGLE_* names win over GADS_* names", async () => {
  const config = await withEnv(
    {
      GADS_CLIENT_ID: "old-id",
      GADS_CLIENT_SECRET: "old-secret",
      ADWARP_GOOGLE_CLIENT_ID: "new-id",
      ADWARP_GOOGLE_CLIENT_SECRET: "new-secret",
      ADWARP_GOOGLE_DEVELOPER_TOKEN: "new-token",
    },
    () => loadGoogleConfig(),
  );
  assert.equal(config.clientId, "new-id");
  assert.equal(config.clientSecret, "new-secret");
  assert.equal(config.developerToken, "new-token");
});
