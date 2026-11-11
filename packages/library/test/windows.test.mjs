/**
 * LinkedIn's walk back in date windows, on a simulated Ad Library: one that applies dateRange (ads whose run touches
 * the window, newest first, up to a cap) and one that ignores it, as LinkedIn may (the parameter is undocumented).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adLibraryRawQuery } from "@adwarp/core";
import { watchlistEntry } from "./helpers.mjs";

const lib = await import("../dist/index.js");
const checkedAt = "2026-11-11";
const COMPANY = "https://www.linkedin.com/company/30898036";
const OTHER = "https://www.linkedin.com/company/999";

const day = (d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
const ad = (id, ranFrom, ranTo, advertiserUrl = COMPANY) => ({
  detailId: id,
  detailUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  advertiser: "Example Software",
  format: "SPONSORED_STATUS_UPDATE",
  detail: { format: "SPONSORED_STATUS_UPDATE", advertiserUrl, ...(ranFrom ? { ranFrom, ranTo } : {}) },
});

/** A library that applies dateRange the way the walk assumes: runs touching [start, end), newest first. */
function honouringSearch(ads, calls = []) {
  return async (opts) => {
    calls.push(opts);
    const start = day(opts.dateRange.start);
    const end = day(opts.dateRange.end);
    const hits = ads
      .filter((a) => a.detail.ranFrom < end && a.detail.ranTo >= start)
      .sort((a, b) => b.detail.ranFrom.localeCompare(a.detail.ranFrom))
      .slice(0, opts.max);
    return { fetched: hits.length, ads: hits };
  };
}

test("windows run newest first, 1 per windowDays, cut at the start of the range", () => {
  assert.deepEqual(lib.planWindows(checkedAt, 90, 30), [
    { start: "2026-10-13", end: "2026-11-12" },
    { start: "2026-09-13", end: "2026-10-13" },
    { start: "2026-08-14", end: "2026-09-13" },
  ]);
  assert.deepEqual(lib.planWindows(checkedAt, 45, 30).at(-1), { start: "2026-09-28", end: "2026-10-13" });
  assert.throws(() => lib.planWindows(checkedAt, 0, 30), /1 or more/);
});

test("a full window splits in 2, newer half first, down to 1 day", () => {
  assert.deepEqual(lib.splitWindow({ start: "2026-10-01", end: "2026-10-31" }), [
    { start: "2026-10-16", end: "2026-10-31" },
    { start: "2026-10-01", end: "2026-10-16" },
  ]);
  assert.equal(lib.splitWindow({ start: "2026-10-01", end: "2026-10-02" }), null);
  assert.deepEqual(lib.toDateRange({ start: "2026-09-01", end: "2026-10-01" }), {
    start: { year: 2026, month: 9, day: 1 },
    end: { year: 2026, month: 10, day: 1 },
  });
});

test("core sends dateRange as literal restli structure with the values encoded", () => {
  const q = adLibraryRawQuery(
    { q: "criteria", count: 25, start: 0, advertiser: "monday.com & Co", countries: "List(urn:li:country:de)" },
    { start: { year: 2026, month: 9, day: 1 }, end: { year: 2026, month: 10, day: 1 } },
  );
  assert.equal(
    q,
    "q=criteria&count=25&start=0&advertiser=monday.com%20%26%20Co&countries=List(urn%3Ali%3Acountry%3Ade)&dateRange=(start:(year:2026,month:9,day:1),end:(year:2026,month:10,day:1))",
  );
});

test("the walk reaches an ad that started long ago, splits full windows and keeps each ad once", async () => {
  const ads = [
    ad("1", "2026-03-02", "2026-11-10"), // the long runner: still live, started 8 months ago
    ...Array.from({ length: 6 }, (_, i) => ad(`n${i}`, `2026-11-${String(5 + i).padStart(2, "0")}`, `2026-11-${String(5 + i).padStart(2, "0")}`)), // 1 launch a day
    ad("2", "2026-09-20", "2026-09-25"),
    ad("x", "2026-11-09", "2026-11-10", OTHER), // a lookalike advertiser
  ];
  const calls = [];
  const walk = await lib.walkLinkedIn({
    search: honouringSearch(ads, calls),
    advertiser: "Example Software",
    companyId: "30898036",
    windows: lib.planWindows(checkedAt, 365, 30),
    max: 1000,
    windowCap: 5,
  });
  const ids = walk.ads.map((a) => a.detailId).sort();
  assert.deepEqual(ids, ["1", "2", "n0", "n1", "n2", "n3", "n4", "n5"], "the long runner is found, the lookalike is not, each ad once");
  assert.deepEqual(walk.truncated, []);
  assert.ok(walk.checked > 0);
  assert.equal(walk.stoppedAtMax, false);
  // 13 windows of 30 days, plus 4 splits of the newest one, which held 8 ads against a cap of 5.
  assert.equal(walk.queries, 21);
  assert.equal(calls.length, 21);
  assert.deepEqual(calls.slice(0, 5).map((c) => [day(c.dateRange.start), day(c.dateRange.end)]), [
    ["2026-10-13", "2026-11-12"],
    ["2026-10-28", "2026-11-12"],
    ["2026-11-04", "2026-11-12"],
    ["2026-11-08", "2026-11-12"],
    ["2026-11-10", "2026-11-12"],
  ]);
});

test("a single day with more ads than the cap is reported as truncated", async () => {
  const ads = Array.from({ length: 7 }, (_, i) => ad(`d${i}`, "2026-11-10", "2026-11-10"));
  const walk = await lib.walkLinkedIn({ search: honouringSearch(ads), advertiser: "E", companyId: "30898036", windows: lib.planWindows(checkedAt, 30, 30), max: 1000, windowCap: 5 });
  assert.equal(walk.ads.length, 5);
  assert.deepEqual(walk.truncated, [{ start: "2026-11-10", end: "2026-11-11" }]);
});

test("the walk stops at max", async () => {
  const ads = Array.from({ length: 20 }, (_, i) => ad(`a${i}`, `2026-0${1 + (i % 9)}-01`, `2026-0${1 + (i % 9)}-20`));
  const walk = await lib.walkLinkedIn({ search: honouringSearch(ads), advertiser: "E", companyId: "30898036", windows: lib.planWindows(checkedAt, 365, 30), max: 3 });
  assert.equal(walk.ads.length, 3);
  assert.equal(walk.stoppedAtMax, true);
});

test("a LinkedIn that ignores dateRange is caught, not trusted", async () => {
  // Like the live Ramp pull: every ad returned was first shown in the last week, whatever the window.
  const newest = Array.from({ length: 194 }, (_, i) => ad(`r${i}`, `2026-11-${String(5 + (i % 7)).padStart(2, "0")}`, "2026-11-11"));
  const ignoring = async (opts) => ({ fetched: Math.min(opts.max, newest.length), ads: newest.slice(0, opts.max) });
  await assert.rejects(
    lib.walkLinkedIn({ search: ignoring, advertiser: "Ramp", companyId: "1406226", windows: lib.planWindows(checkedAt, 365, 30), max: 5000 }),
    (err) => {
      assert.equal(err.name, "DateRangeUnverifiedError");
      assert.match(err.message, /ran 2026-11-\d\d to 2026-11-11, outside the requested 2026-09-13 to 2026-10-13/);
      assert.match(err.message, /Run without --walk-back/);
      return true;
    },
  );
});

test("a rejected dateRange on the first window is reported as unverified", async () => {
  const rejecting = async () => {
    const err = new Error("Invalid query parameter dateRange");
    err.status = 400;
    throw err;
  };
  await assert.rejects(
    lib.walkLinkedIn({ search: rejecting, advertiser: "E", companyId: "1", windows: lib.planWindows(checkedAt, 60, 30), max: 10 }),
    /LinkedIn answered 400 to the first window/,
  );
});

test("collect with walkBack says when no dated ad could test the range", async () => {
  const undated = [ad("u1"), ad("u2")];
  const search = async (opts) => ({ fetched: 2, ads: opts.dateRange && day(opts.dateRange.end) === "2026-11-12" ? undated : [] });
  const res = await lib.collectLinkedIn({ entry: watchlistEntry, category: "B2B SaaS", checkedAt, max: 100, search, walkBack: { days: 60, windowDays: 30 } });
  assert.equal(res.candidates.length, 2);
  assert.match(res.note, /Walked back 60 days in 2 queries/);
  assert.match(res.note, /never checked/);

  const watchlist = lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers: [watchlistEntry] });
  await assert.rejects(lib.collect({ platform: "meta", watchlist, countries: ["DE"], walkBack: { days: 60, windowDays: 30 }, env: {} }), /LinkedIn only/);
  const file = await lib.collect({ platform: "linkedin", watchlist, checkedAt, linkedinSearch: search, walkBack: { days: 60, windowDays: 30 }, env: {} });
  assert.equal(file.query.max, 5000);
  assert.deepEqual(file.query.walkBack, { days: 60, windowDays: 30 });
  assert.deepEqual(file.tracked, ["Example Software"]);
});
