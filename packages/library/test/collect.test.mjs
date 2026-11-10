/**
 * The collect runner and the credential boundary. The library must never borrow the credentials Adwarp uses for
 * ad accounts (often an employer's app): only ADWARP_LIBRARY_* is read, and a missing variable is a clear error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeApiElement } from "@adwarp/core";
import { fakeFetch, fixture, watchlistEntry } from "./helpers.mjs";

const lib = await import("../dist/index.js");
const checkedAt = "2026-11-08";

const ACCOUNT_ENV = {
  ADWARP_LINKEDIN_CLIENT_ID: "employer-app",
  ADWARP_LINKEDIN_CLIENT_SECRET: "employer-secret",
  ADWARP_LINKEDIN_REFRESH_TOKEN: "employer-refresh",
  LIADS_CLIENT_ID: "old-employer-app",
  LIADS_CLIENT_SECRET: "old-employer-secret",
  LIADS_REFRESH_TOKEN: "old-employer-refresh",
  ADWARP_GOOGLE_CLIENT_ID: "employer-google",
};

test("library credentials ignore the ad-account variables and name what to set", async () => {
  assert.throws(() => lib.linkedinLibraryCredentials(ACCOUNT_ENV), (err) => {
    assert.equal(err.name, "MissingLibraryCredentialsError");
    assert.match(err.message, /ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN/);
    assert.match(err.message, /never read here/);
    assert.ok(!err.message.includes("employer"));
    return true;
  });
  await assert.rejects(lib.linkedinLibrarySearch(ACCOUNT_ENV), /LinkedIn library credentials are missing/);
  assert.throws(() => lib.metaLibraryCredentials(ACCOUNT_ENV), /ADWARP_LIBRARY_META_ACCESS_TOKEN/);
  assert.throws(() => lib.tiktokLibraryCredentials(ACCOUNT_ENV), /ADWARP_LIBRARY_TIKTOK_CLIENT_KEY, ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET/);
  assert.throws(() => lib.googleLibraryCredentials({ ...ACCOUNT_ENV, ADWARP_LIBRARY_GOOGLE_PROJECT: "p" }), /Set ADWARP_LIBRARY_GOOGLE_ACCESS_TOKEN\./);

  assert.deepEqual(lib.linkedinLibraryCredentials({ ...ACCOUNT_ENV, ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN: " tok " }), { kind: "access-token", accessToken: "tok" });
  assert.equal(lib.metaLibraryCredentials({ ADWARP_LIBRARY_META_ACCESS_TOKEN: "m" }).version, lib.DEFAULT_META_API_VERSION);
});

test("collect skips entries without the platform's ID and keeps going past 1 advertiser's failure", async () => {
  const raw = fixture("linkedin-ad-library.json");
  const watchlist = lib.parseWatchlist({
    version: 1,
    category: "B2B SaaS",
    advertisers: [
      watchlistEntry,
      { name: "Broken Co", linkedin: { companyId: "5" } },
      { name: "No LinkedIn ID", meta: { pageIds: ["9"] } },
    ],
  });
  const linkedinSearch = async ({ advertiser }) => {
    if (advertiser === "Broken Co") throw new Error("LinkedIn answered 500");
    return { fetched: 3, ads: raw.elements.map((el) => normalizeApiElement(el)) };
  };
  const file = await lib.collect({ platform: "linkedin", watchlist, checkedAt, linkedinSearch, env: {} });
  assert.equal(file.version, 1);
  assert.equal(file.collectedAt, checkedAt);
  assert.equal(file.candidates.length, 2);
  assert.deepEqual(file.skipped, [{ advertiser: "No LinkedIn ID", reason: "no linkedin.companyId" }]);
  assert.deepEqual(file.errors, [{ advertiser: "Broken Co", message: "LinkedIn answered 500" }]);
  assert.deepEqual(lib.parseCandidatesFile(JSON.parse(JSON.stringify(file))).candidates.length, 2);
});

test("collect needs countries for Meta and TikTok, and fails fast without credentials", async () => {
  const watchlist = lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers: [watchlistEntry] });
  await assert.rejects(lib.collect({ platform: "meta", watchlist, env: {} }), /meta needs countries/);
  await assert.rejects(lib.collect({ platform: "meta", watchlist, countries: ["DE"], env: ACCOUNT_ENV }), /Meta library credentials are missing/);
});

test("collect on TikTok fetches a token, then queries each country", async () => {
  const watchlist = lib.parseWatchlist({ version: 1, category: "B2B SaaS", countries: { tiktok: ["de", "FR"] }, advertisers: [watchlistEntry] });
  const fetch = fakeFetch((url) =>
    url.includes("/oauth/token/") ? { body: { access_token: "tok" } } : { body: { data: { ads: [], has_more: false }, error: { code: "ok" } } },
  );
  const file = await lib.collect({
    platform: "tiktok",
    watchlist,
    checkedAt,
    fetch,
    delayScale: 0,
    env: { ADWARP_LIBRARY_TIKTOK_CLIENT_KEY: "k", ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET: "s" },
  });
  assert.deepEqual(file.query.countries, ["DE", "FR"]);
  assert.equal(fetch.calls.length, 3);
  assert.equal(fetch.calls[1].init.headers.Authorization, "Bearer tok");
  assert.equal(JSON.parse(fetch.calls[2].init.body).filters.country_code, "FR");
});

test("the watchlist rejects loose IDs", () => {
  assert.throws(
    () => lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers: [{ name: "X", linkedin: { companyId: "abc" }, google: { advertiserIds: ["123"] } }] }),
    /linkedin\.companyId must be digits[\s\S]*AR followed by digits/,
  );
  assert.throws(() => lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers: [{ name: "X" }, { name: "x" }] }), /listed twice/);
});

test("errors never print a token from a URL", () => {
  assert.equal(
    lib.redactUrl("https://graph.facebook.com/v25.0/ads_archive?access_token=SECRET&limit=5"),
    "https://graph.facebook.com/v25.0/ads_archive?access_token=REDACTED&limit=5",
  );
  assert.equal(lib.quoteBigIds('{"id": 7412345678901234567, "n": 5}', ["id"]), '{"id": "7412345678901234567", "n": 5}');
});
