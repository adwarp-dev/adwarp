/**
 * Guards the promises the Ad Library scraper makes about the user's IP.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first). No browser, no
 * network: these pin the pure pieces. If they fail, a scan can keep hammering
 * LinkedIn after Cloudflare has already blocked the user.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { isBlockedPage, AdLibraryBlockedError, SCRAPER_DEFAULTS, AdLibraryScanSchema } = await import("../dist/index.js");

test("defaults are one page at a time, paused, and capped", () => {
  assert.equal(SCRAPER_DEFAULTS.concurrency, 1);
  assert.ok(SCRAPER_DEFAULTS.pageDelayMs >= 1000);
  assert.ok(SCRAPER_DEFAULTS.copyMax <= 50);
});

test("MCP schema defaults match the scraper defaults", () => {
  const parsed = AdLibraryScanSchema.parse({ advertiser: "Ramp" });
  assert.equal(parsed.concurrency, SCRAPER_DEFAULTS.concurrency);
  assert.equal(parsed.copyMax, SCRAPER_DEFAULTS.copyMax);
  assert.throws(() => AdLibraryScanSchema.parse({ advertiser: "Ramp", concurrency: 8 }));
});

test("recognises Cloudflare's block and challenge pages", () => {
  assert.equal(isBlockedPage(403, "", ""), true);
  assert.equal(isBlockedPage(429, "", ""), true);
  assert.equal(isBlockedPage(503, "", ""), true);
  assert.equal(
    isBlockedPage(200, "Attention Required! | Cloudflare", "Sorry, you have been blocked\nYou are unable to access linkedin.com\nPerformance & security by Cloudflare"),
    true,
  );
  assert.equal(isBlockedPage(200, "Just a moment...", "Checking your browser. Cloudflare challenge"), true);
});

test("does not mistake the library itself for a block", () => {
  assert.equal(isBlockedPage(200, "Ad Library | LinkedIn", "9,081 ads\nRamp\nPromoted"), false);
  assert.equal(isBlockedPage(undefined, "Ad Library | LinkedIn", ""), false);
});

test("the block error says what to do and carries partial copy", () => {
  const e = new AdLibraryBlockedError(7, "an ad detail page");
  assert.equal(e.name, "AdLibraryBlockedError");
  assert.equal(e.pagesFetched, 7);
  assert.match(e.message, /blocked this IP/);
  assert.match(e.message, /do not retry/);
  e.partialCopy = new Map([["1", { commentary: "x" }]]);
  assert.equal(e.partialCopy.size, 1);
});
