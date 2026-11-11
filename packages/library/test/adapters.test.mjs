/**
 * The 4 adapters on fixtures shaped like each platform's documented response. These pin what each number means
 * (its kind and geography), which ads are kept, and that no token or signed URL ends up in a candidate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeApiElement } from "@adwarp/core";
import { fakeFetch, fixture, fixtureText, watchlistEntry } from "./helpers.mjs";

const lib = await import("../dist/index.js");
const checkedAt = "2026-11-08";

test("LinkedIn keeps only the company's ads and reads the band as a total with its countries as regions", async () => {
  const raw = fixture("linkedin-ad-library.json");
  const search = async () => ({ fetched: 3, totalReported: 3, ads: raw.elements.map((el) => normalizeApiElement(el)) });
  const res = await lib.collectLinkedIn({ entry: watchlistEntry, category: "B2B SaaS", checkedAt, max: 50, search });
  assert.deepEqual(res.candidates.map((c) => c.source.adId), ["1599585996", "1600000001"]);

  const [image, video] = res.candidates;
  assert.equal(image.format, "single-image");
  assert.equal(image.sourceFormat, "SPONSORED_STATUS_UPDATE");
  assert.equal(image.firstShown, "2026-09-09");
  assert.equal(image.lastShown, "2026-11-07");
  assert.equal(image.live, true, "an impression the day before the check counts as live");
  assert.deepEqual(image.regions, ["DE", "US"]);
  assert.deepEqual(image.metrics, [
    { name: "impressions", kind: "range", lower: 100000, upper: 200000, text: "100k-200k", geography: "total", period: "lifetime", source: "LinkedIn Ad Library API", collectedAt: checkedAt },
  ]);
  assert.equal(image.copy, null);
  assert.equal(image.advertiser.platformId, "30898036");
  assert.ok(image.notes.some((n) => n.startsWith("Targeting facets: Job functions; excludes Company")));

  assert.equal(video.format, "video", "an unlisted code is matched by the format word it contains");
  assert.deepEqual(video.metrics, [], "no band means no metric, never 0");
  assert.equal(video.live, null);
});

test("LinkedIn bands: open-ended top band and an upper-only band", () => {
  assert.deepEqual(lib.linkedinImpressions({ from: 1000000 }, checkedAt), {
    name: "impressions", kind: "range", lower: 1000000, text: "1M+", geography: "total", period: "lifetime", source: "LinkedIn Ad Library API", collectedAt: checkedAt,
  });
  const under = lib.linkedinImpressions({ to: 1000 }, checkedAt);
  assert.equal(under.lower, 0);
  assert.equal(under.upper, 1000);
  assert.equal(under.text, "under 1k");
  assert.equal(lib.linkedinImpressions(undefined, checkedAt), undefined);
});

test("LinkedIn format codes", () => {
  assert.equal(lib.linkedinFormat("TEXT_AD"), "text");
  assert.equal(lib.linkedinFormat("SPOTLIGHT_V2"), "spotlight");
  assert.equal(lib.linkedinFormat("SPONSORED_INMAILS"), "message");
  assert.equal(lib.linkedinFormat("SPONSORED_UPDATE_CAROUSEL"), "carousel");
  assert.equal(lib.linkedinFormat("SOMETHING_NEW"), "other");
  assert.equal(lib.linkedinFormat(undefined), "other");
});

test("Meta: ACTIVE then INACTIVE, cursor paging, EU reach as an estimate, and no token anywhere", async () => {
  const fetch = fakeFetch((url) => {
    const u = new URL(url);
    if (u.searchParams.get("ad_active_status") === "ACTIVE")
      return { body: u.searchParams.get("after") === "CURSOR1" ? fixture("meta-ads-archive-active-2.json") : fixture("meta-ads-archive-active.json") };
    return { body: fixture("meta-ads-archive-inactive.json") };
  });
  const res = await lib.collectMeta({ entry: watchlistEntry, category: "B2B SaaS", checkedAt, max: 50, countries: ["DE", "FR"], accessToken: "SECRET", version: "v25.0", fetch, delayScale: 0 });

  const first = new URL(fetch.calls[0].url);
  assert.equal(first.pathname, "/v25.0/ads_archive");
  assert.equal(first.searchParams.get("search_page_ids"), '["111"]');
  assert.equal(first.searchParams.get("ad_reached_countries"), '["DE","FR"]');
  assert.equal(first.searchParams.get("ad_type"), "ALL");
  assert.equal(fetch.calls.length, 3, "2 ACTIVE pages, then 1 INACTIVE page");

  assert.deepEqual(res.candidates.map((c) => c.source.adId), ["1200000000000001", "1200000000000002", "1200000000000003"], "the other Page's ad is dropped");
  const [a, , stopped] = res.candidates;
  assert.equal(a.source.url, "https://www.facebook.com/ads/library/?id=1200000000000001");
  assert.equal(a.live, true);
  assert.equal(a.lastShown, checkedAt, "the ACTIVE filter means it delivered on the check day");
  assert.deepEqual(a.metrics, [
    { name: "reach", kind: "estimate", value: 48213, text: "48213", geography: "EU", period: "lifetime", source: "Meta Ad Library API (eu_total_reach)", collectedAt: checkedAt },
  ]);
  assert.equal(a.copy.intro, "Close your books 3 days faster — no spreadsheets 🚀", "copy is quoted word for word");
  assert.deepEqual(a.regions, ["DE", "FR"]);
  assert.equal(stopped.live, false);
  assert.equal(stopped.lastShown, "2026-07-15");
  assert.equal(stopped.copy.headline, "Book a demo");
  assert.ok(!JSON.stringify(res).includes("SECRET"), "the access token and snapshot URL never reach a candidate");
});

test("TikTok: business ID filter, both spellings, 64-bit IDs kept exact, reach scoped to the country", async () => {
  const fetch = fakeFetch(() => ({ body: fixtureText("tiktok-query.json") }));
  const res = await lib.collectTikTok({ entry: watchlistEntry, category: "B2B SaaS", checkedAt, max: 50, countries: ["DE"], accessToken: "T", fetch, delayScale: 0 });

  const call = fetch.calls[0];
  assert.ok(call.url.startsWith("https://open.tiktokapis.com/v2/research/adlib/ad/query/?fields=ad.id,"));
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.filters, { ad_published_date_range: { min: "20251108", max: "20261107" }, country_code: "DE" });
  assert.equal(body.search_term, "Example Software");

  assert.deepEqual(res.candidates.map((c) => c.source.adId), ["7412345678901234567", "7412345678901234999"]);
  const [video, image] = res.candidates;
  assert.equal(video.advertiser.platformId, "7000000000000000001");
  assert.equal(video.format, "video");
  assert.equal(video.firstShown, "2026-08-01");
  assert.equal(video.live, null, "TikTok's status is review status, not serving");
  assert.deepEqual(video.metrics[0], { name: "unique-users-seen", kind: "estimate", value: 11000, text: "11K", geography: "DE", period: "lifetime", source: "TikTok Commercial Content API", collectedAt: checkedAt });
  assert.deepEqual(video.creativeRefs, ["https://v.example.com/video.mp4"], "signed query strings are stripped");
  assert.equal(image.format, "single-image");
  assert.deepEqual(image.metrics[0], { name: "unique-users-seen", kind: "range", lower: 0, upper: 1000, text: "0-1K", geography: "DE", period: "lifetime", source: "TikTok Commercial Content API", collectedAt: checkedAt });
});

test("TikTok token request uses client credentials", async () => {
  const fetch = fakeFetch(() => ({ body: { access_token: "abc", expires_in: 7200, token_type: "Bearer" } }));
  assert.equal(await lib.tiktokAccessToken("key", "secret", fetch), "abc");
  assert.equal(fetch.calls[0].url, "https://open.tiktokapis.com/v2/oauth/token/");
  assert.equal(String(fetch.calls[0].init.body), "client_key=key&client_secret=secret&grant_type=client_credentials");
});

test("Google: dry run first, a byte cap BigQuery enforces, 1 candidate per ad with a metric per region", async () => {
  const fetch = fakeFetch((url, init) => {
    const body = JSON.parse(init.body);
    if (body.dryRun) return { body: { totalBytesProcessed: "1073741824", jobComplete: true } };
    return { body: fixture("bigquery-query.json") };
  });
  const res = await lib.collectGoogle({ entries: [watchlistEntry], category: "B2B SaaS", checkedAt, max: 50, countries: ["DE", "FR"], project: "test-project", accessToken: "G", fetch, maxBytes: 2 * 1024 ** 3, delayScale: 0 });

  assert.equal(fetch.calls.length, 2);
  const real = JSON.parse(fetch.calls[1].init.body);
  assert.equal(real.maximumBytesBilled, String(2 * 1024 ** 3));
  assert.equal(real.useLegacySql, false);
  assert.deepEqual(real.queryParameters.find((p) => p.name === "advertiser_ids").parameterValue.arrayValues, [{ value: "AR111" }]);
  assert.equal(fetch.calls[1].url, "https://bigquery.googleapis.com/bigquery/v2/projects/test-project/queries");

  assert.deepEqual(res.candidates.map((c) => c.source.adId), ["CR001", "CR002"], "the advertiser not on the watchlist is dropped");
  const [text, video] = res.candidates;
  assert.equal(text.format, "text");
  assert.equal(text.firstShown, "2026-06-01");
  assert.equal(text.lastShown, "2026-11-05");
  assert.deepEqual(text.regions, ["DE", "FR"]);
  assert.deepEqual(text.metrics.map((m) => [m.geography, m.lower, m.upper, m.period]), [
    ["DE", 100000, 150000, "2026-06-01/2026-11-01"],
    ["FR", 5000, 10000, "lifetime"],
  ]);
  assert.equal(video.format, "video");
  assert.deepEqual(video.metrics, [], "null bounds mean no metric, never 0");
});

test("Google refuses to run a query whose dry run passes the byte cap", async () => {
  const fetch = fakeFetch(() => ({ body: { totalBytesProcessed: String(50 * 1024 ** 3), jobComplete: true } }));
  await assert.rejects(
    lib.collectGoogle({ entries: [watchlistEntry], category: "B2B SaaS", checkedAt, max: 50, countries: [], project: "p", accessToken: "G", fetch, maxBytes: 20 * 1024 ** 3, delayScale: 0 }),
    /would scan 50\.0 GiB, over the 20\.0 GiB limit/,
  );
  assert.equal(fetch.calls.length, 1, "only the dry run was sent");
});

test("Google polls an unfinished job and follows page tokens", async () => {
  const full = fixture("bigquery-query.json");
  const fetch = fakeFetch((url, init) => {
    if (init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.dryRun) return { body: { totalBytesProcessed: "10" } };
      return { body: { jobComplete: false, jobReference: { jobId: "job_1", location: "US" } } };
    }
    const u = new URL(url);
    if (!u.searchParams.get("pageToken")) return { body: { ...full, rows: full.rows.slice(0, 2), pageToken: "P2" } };
    return { body: { jobComplete: true, rows: full.rows.slice(2) } };
  });
  const res = await lib.collectGoogle({ entries: [watchlistEntry], category: "B2B SaaS", checkedAt, max: 50, countries: [], project: "p", accessToken: "G", fetch, delayScale: 0 });
  assert.equal(res.fetched, 4);
  assert.deepEqual(res.candidates.map((c) => c.source.adId), ["CR001", "CR002"]);
  assert.ok(fetch.calls[2].url.includes("/queries/job_1?"));
  assert.ok(fetch.calls[2].url.includes("location=US"));
});

test("count parsing keeps the source's kind", () => {
  const scope = { geography: "DE", period: "lifetime", source: "s", collectedAt: checkedAt };
  assert.equal(lib.countMetric("reach", "1234", scope).kind, "exact");
  assert.equal(lib.countMetric("reach", "1.5M", scope).value, 1500000);
  assert.equal(lib.countMetric("reach", "1.5M", scope).kind, "estimate");
  assert.equal(lib.countMetric("reach", "Top 10%", scope).kind, "relative");
  assert.equal(lib.countMetric("reach", "Top 10%", scope).value, undefined);
  assert.equal(lib.countMetric("reach", "", scope), undefined);
  assert.equal(lib.countMetric("reach", undefined, scope), undefined);
});
