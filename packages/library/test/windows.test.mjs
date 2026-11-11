/**
 * LinkedIn's walk back 1 calendar month at a time, on a simulated Ad Library that behaves the way the live checks on
 * 2026-11-11 showed: dateRange returns the ads SERVED during the range (newest first, up to the cap), nothing before
 * December 2025 (the 12-month lookback), and nothing for a range ending today or later. Ads never served in the EU
 * carry no dates, so the months they come back in are their only run evidence.
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
/** An ad served from `from` to `to`. EU ads carry those dates; others (eu: false) carry none, like the real API. */
const ad = (id, from, to, { eu = true, advertiserUrl = COMPANY } = {}) => ({
  detailId: id,
  detailUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  advertiser: "Example Software",
  format: "SPONSORED_STATUS_UPDATE",
  detail: { format: "SPONSORED_STATUS_UPDATE", advertiserUrl, ...(eu && from ? { ranFrom: from, ranTo: to } : {}) },
  served: [from, to],
});

/** The verified behaviour: served during [start, end] (end inclusive), 12-month lookback, nothing ending today. */
function linkedin(ads, calls = []) {
  return async (opts) => {
    calls.push(opts);
    const start = day(opts.dateRange.start);
    const end = day(opts.dateRange.end);
    if (end >= checkedAt || end < "2025-12-01") return { fetched: 0, ads: [] };
    const hits = ads
      .filter((a) => a.served[0] <= end && a.served[1] >= start)
      .sort((a, b) => b.served[0].localeCompare(a.served[0]))
      .slice(0, opts.max);
    return { fetched: hits.length, ads: hits };
  };
}

test("months run newest first: this month up to yesterday, then whole months, 12 at most", () => {
  const months = lib.planMonths(checkedAt);
  assert.equal(months.length, 12);
  assert.deepEqual(months[0], { start: "2026-11-01", end: "2026-11-11" });
  assert.deepEqual(months[1], { start: "2026-10-01", end: "2026-11-01" });
  assert.deepEqual(months.at(-1), { start: "2025-12-01", end: "2026-01-01" });
  assert.deepEqual(lib.planMonths("2026-11-01", 2), [
    { start: "2026-10-01", end: "2026-11-01" },
    { start: "2026-09-01", end: "2026-10-01" },
  ]);
  assert.deepEqual(lib.planMonths("2026-03-01", 2)[1], { start: "2026-01-01", end: "2026-02-01" });
  assert.throws(() => lib.planMonths(checkedAt, 13), /reaches back about 12 months/);
});

test("a window is sent ending on its own last day, and never on today or later", () => {
  assert.deepEqual(lib.toDateRange({ start: "2026-10-01", end: "2026-11-01" }, checkedAt), {
    start: { year: 2026, month: 10, day: 1 },
    end: { year: 2026, month: 10, day: 31 },
  });
  assert.deepEqual(lib.toDateRange({ start: "2026-11-01", end: "2026-11-11" }, checkedAt).end, { year: 2026, month: 11, day: 10 });
  assert.throws(() => lib.toDateRange({ start: "2026-11-01", end: "2026-11-12" }, checkedAt), /can't end on 2026-11-11/);
});

test("a full window splits in 2, newer half first, down to 1 day", () => {
  assert.deepEqual(lib.splitWindow({ start: "2026-10-01", end: "2026-11-01" }), [
    { start: "2026-10-16", end: "2026-11-01" },
    { start: "2026-10-01", end: "2026-10-16" },
  ]);
  assert.equal(lib.splitWindow({ start: "2026-10-01", end: "2026-10-02" }), null);
});

test("core sends dateRange as literal restli structure with the values encoded", () => {
  const q = adLibraryRawQuery(
    { q: "criteria", count: 25, start: 0, advertiser: "monday.com & Co", countries: "List(urn:li:country:de)" },
    { start: { year: 2026, month: 9, day: 1 }, end: { year: 2026, month: 9, day: 30 } },
  );
  assert.equal(
    q,
    "q=criteria&count=25&start=0&advertiser=monday.com%20%26%20Co&countries=List(urn%3Ali%3Acountry%3Ade)&dateRange=(start:(year:2026,month:9,day:1),end:(year:2026,month:9,day:30))",
  );
});

test("the walk finds long runners, records the months each was served in, and marks lookback floors", async () => {
  const ads = [
    ad("1", "2026-03-02", "2026-11-10"), // EU long runner, still live
    ad("u1", "2025-12-15", "2026-10-20", { eu: false }), // US only, served since before the lookback edge
    ad("u2", "2026-02-10", "2026-06-05", { eu: false }), // US only, started inside the lookback
    ...Array.from({ length: 6 }, (_, i) => ad(`n${i}`, `2026-11-${String(5 + i).padStart(2, "0")}`, `2026-11-${String(5 + i).padStart(2, "0")}`)),
    ad("x", "2026-11-09", "2026-11-10", { advertiserUrl: OTHER }),
  ];
  const calls = [];
  const walk = await lib.walkLinkedIn({
    search: linkedin(ads, calls),
    advertiser: "Example Software",
    companyId: "30898036",
    windows: lib.planMonths(checkedAt),
    checkedAt,
    max: 1000,
    windowCap: 5,
  });
  assert.deepEqual(walk.ads.map((a) => a.detailId).sort(), ["1", "n0", "n1", "n2", "n3", "n4", "n5", "u1", "u2"], "each ad once, the lookalike left out");
  assert.deepEqual(walk.served["1"], ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(walk.served.u1, ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.deepEqual(walk.served.u2, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(walk.served.n0, ["2026-11"]);
  assert.equal(lib.servedFloor(walk.served.u1, walk), "lookback", "December 2025 is as far back as the filter goes");
  assert.equal(lib.servedFloor(walk.served.u2, walk), undefined, "January was read in full and didn't list it");
  assert.deepEqual(walk.months[0], "2025-12");
  assert.deepEqual(walk.incomplete, []);
  assert.deepEqual(walk.truncated, []);
  assert.ok(walk.checked > 0);

  // November held 8 ads against a cap of 5, so it was split until each piece fit: 7 queries, then 11 whole months.
  assert.equal(walk.queries, 18);
  assert.deepEqual([day(calls[0].dateRange.start), day(calls[0].dateRange.end)], ["2026-11-01", "2026-11-10"]);
  assert.ok(calls.every((c) => day(c.dateRange.end) < checkedAt), "no range ends today or later");
});

test("a day still full after splitting is reported, and its month counts as unread", async () => {
  const ads = [
    ...Array.from({ length: 7 }, (_, i) => ad(`d${i}`, "2026-10-10", "2026-10-10", { eu: false })),
    ad("late", "2026-11-02", "2026-11-03", { eu: false }),
  ];
  const walk = await lib.walkLinkedIn({ search: linkedin(ads), advertiser: "E", companyId: "30898036", windows: lib.planMonths(checkedAt, 2), checkedAt, max: 1000, windowCap: 5 });
  assert.deepEqual(walk.truncated, [{ start: "2026-10-10", end: "2026-10-11" }]);
  assert.deepEqual(walk.incomplete, ["2026-10"]);
  assert.equal(lib.servedFloor(walk.served.late, walk), "unread", "October wasn't read in full, so November may not be its first month");
});

test("the walk stops at max and counts the months it didn't reach as unread", async () => {
  const ads = Array.from({ length: 20 }, (_, i) => ad(`a${i}`, "2026-10-01", "2026-11-10", { eu: false }));
  const walk = await lib.walkLinkedIn({ search: linkedin(ads), advertiser: "E", companyId: "30898036", windows: lib.planMonths(checkedAt), checkedAt, max: 3 });
  assert.equal(walk.ads.length, 3);
  assert.equal(walk.stoppedAtMax, true);
  assert.equal(walk.incomplete.length, 11);
  assert.equal(lib.servedFloor(walk.served.a0, walk), "unread");
});

test("a window ending today is refused before any call", async () => {
  let called = false;
  await assert.rejects(
    lib.walkLinkedIn({
      search: async () => ((called = true), { fetched: 0, ads: [] }),
      advertiser: "E",
      companyId: "1",
      windows: [{ start: "2026-11-01", end: "2026-11-12" }],
      checkedAt,
      max: 10,
    }),
    /can't end on 2026-11-11/,
  );
  assert.equal(called, false);
});

test("a LinkedIn that stops applying dateRange is caught, not trusted", async () => {
  // Like the live Ramp pull without a range: every ad first shown in the last week, whatever window is asked for.
  const newest = Array.from({ length: 194 }, (_, i) => ad(`r${i}`, `2026-11-${String(5 + (i % 6)).padStart(2, "0")}`, "2026-11-10"));
  const ignoring = async (opts) => ({ fetched: Math.min(opts.max, newest.length), ads: newest.slice(0, opts.max) });
  await assert.rejects(
    lib.walkLinkedIn({ search: ignoring, advertiser: "Ramp", companyId: "1406226", windows: lib.planMonths(checkedAt), checkedAt, max: 20000 }),
    (err) => {
      assert.equal(err.name, "DateRangeMismatchError");
      assert.match(err.message, /ran 2026-11-\d\d to 2026-11-10, outside the requested 2026-10-01 to 2026-10-31/);
      return true;
    },
  );
});

test("a rejected dateRange on the first window is reported", async () => {
  const rejecting = async () => {
    const err = new Error("Invalid query parameter dateRange");
    err.status = 400;
    throw err;
  };
  await assert.rejects(
    lib.walkLinkedIn({ search: rejecting, advertiser: "E", companyId: "1", windows: lib.planMonths(checkedAt, 2), checkedAt, max: 10 }),
    /LinkedIn answered 400 to the first window/,
  );
});

test("collect with walkBack puts served months and the floor on each candidate", async () => {
  const ads = [ad("u1", "2025-12-15", "2026-10-20", { eu: false }), ad("u2", "2026-02-10", "2026-06-05", { eu: false })];
  const watchlist = lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers: [watchlistEntry] });
  const file = await lib.collect({ platform: "linkedin", watchlist, checkedAt, linkedinSearch: linkedin(ads), walkBack: { months: 12, windowCap: 1000 }, env: {} });
  assert.equal(file.query.max, 20000);
  assert.deepEqual(file.query.walkBack, { months: 12, windowCap: 1000 });
  const [u1, u2] = ["u1", "u2"].map((id) => file.candidates.find((c) => c.source.adId === id));
  assert.equal(u1.servedMonths.length, 11);
  assert.equal(u1.servedMonthsFloor, "lookback");
  assert.equal(u1.firstShown, null);
  assert.ok(u1.notes.some((n) => n.startsWith("LinkedIn's date filter lists it as served in 11 months: 2025-12,") && n.includes("The first is a floor")));
  assert.deepEqual(u2.servedMonths, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  assert.equal(u2.servedMonthsFloor, undefined);

  await assert.rejects(lib.collect({ platform: "meta", watchlist, countries: ["DE"], walkBack: { months: 12 }, env: {} }), /LinkedIn only/);
});
