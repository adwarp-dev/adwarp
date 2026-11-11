/**
 * The collector's side of staying within LinkedIn's limits: a throttled or budget-stopped run ends at once and keeps
 * what it read, daily runs stop at the first page with nothing new, the budget holds across runs, and --walk-back
 * skips advertisers walked back in the last 7 days and resumes where it stopped. Fake clients, fake clocks, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdLibraryBudgetError, AdLibraryGuard, AdLibraryThrottledError, DailyCallBudget, normalizeApiElement, searchAdLibraryApi } from "@adwarp/core";

const lib = await import("../dist/index.js");
const checkedAt = "2026-11-11";
const RAMP = { name: "Ramp", linkedin: { companyId: "1406226" } };
const RIPPLING = { name: "Rippling", linkedin: { companyId: "17988315" } };
const NOTION = { name: "Notion", linkedin: { companyId: "30898036" } };
const watchlist = (...advertisers) => lib.parseWatchlist({ version: 1, category: "B2B SaaS", advertisers });

const element = (id, companyId) => ({
  adUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  details: { type: "SPONSORED_STATUS_UPDATE", advertiser: { advertiserName: "x", advertiserUrl: `https://www.linkedin.com/company/${companyId}` } },
});

/** A fake LinkedIn client that serves each advertiser's ads newest first, 25 a page, and counts calls. */
function linkedinClient(adsByAdvertiser) {
  const calls = [];
  return {
    calls,
    request: async (opts) => {
      calls.push(opts);
      const all = adsByAdvertiser[opts.query.advertiser] ?? [];
      const start = Number(opts.query.start);
      return { data: { elements: all.slice(start, start + Number(opts.query.count)), paging: { total: all.length } } };
    },
  };
}
const fakeGuard = (budget) => {
  const clock = { t: 1_800_000_000_000 };
  const slept = [];
  const guard = new AdLibraryGuard({ budget, pacer: { last: 0 }, now: () => clock.t, sleep: async (ms) => (slept.push(ms), (clock.t += ms)), random: () => 0 });
  return { guard, slept };
};
const searchWith = (client, guard) => (o) => searchAdLibraryApi(client, { ...o, guard });

test("a throttled advertiser stops the whole run: its ads so far are kept, the rest are marked not reached", async () => {
  const asked = [];
  const search = async (o) => {
    asked.push(o.advertiser);
    if (o.advertiser === "Ramp") return { fetched: 2, ads: ["1", "2"].map((id) => normalizeApiElement(element(id, "1406226"))) };
    const err = new AdLibraryThrottledError("LinkedIn answered 429 to the Ad Library with no Retry-After. The app's daily Ad Library quota is likely spent until midnight UTC.");
    err.partial = { fetched: 1, ads: [normalizeApiElement(element("9", "17988315"))] };
    throw err;
  };
  const file = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING, NOTION), checkedAt, linkedinSearch: search, env: {} });
  assert.deepEqual(asked, ["Ramp", "Rippling"], "Notion was never asked for");
  assert.deepEqual(file.candidates.map((c) => c.source.adId), ["1", "2", "9"]);
  assert.equal(file.stopped.reason, "throttled");
  assert.match(file.stopped.message, /quota is likely spent until midnight UTC/);
  assert.deepEqual(file.errors, [{ advertiser: "Notion", message: "Not reached: the run stopped (throttled)." }]);
  assert.deepEqual(file.tracked, ["Ramp"], "a first pull cut short is a baseline, not tracked, so its ads never flood the next alert");
});

test("with --previous, a daily run reads newest first and stops at the first full page with nothing new", async () => {
  const ramp = Array.from({ length: 80 }, (_, i) => element(`${1000 + i}`, "1406226"));
  const rippling = Array.from({ length: 60 }, (_, i) => element(`${2000 + i}`, "17988315"));
  // Yesterday's run had every ad but Ramp's 3 newest.
  const yesterdayClient = linkedinClient({ Ramp: ramp.slice(3), Rippling: rippling });
  const yesterday = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING), checkedAt: "2026-11-10", max: 500, linkedinSearch: searchWith(yesterdayClient, fakeGuard().guard), env: {} });
  assert.equal(yesterday.candidates.length, 137);

  const client = linkedinClient({ Ramp: ramp, Rippling: rippling });
  const today = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING), checkedAt, max: 500, previous: yesterday, linkedinSearch: searchWith(client, fakeGuard().guard), env: {} });
  const perAdvertiser = (name) => client.calls.filter((c) => c.query.advertiser === name).length;
  assert.equal(perAdvertiser("Ramp"), 2, "page 1 had 3 new ads, page 2 had none");
  assert.equal(perAdvertiser("Rippling"), 1, "page 1 had nothing new");
  assert.equal(today.candidates.length, 140, "ads not read again are kept from yesterday");

  const { report } = lib.compareWithPrevious(yesterday, today);
  assert.deepEqual(report.launched.map((g) => [g.advertiser, g.ads.map((a) => a.adId)]), [["Ramp", ["1000", "1001", "1002"]]]);

  // --no-incremental reads up to --max again.
  const full = linkedinClient({ Ramp: ramp, Rippling: rippling });
  await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING), checkedAt, max: 500, previous: yesterday, incremental: false, linkedinSearch: searchWith(full, fakeGuard().guard), env: {} });
  assert.equal(full.calls.length, 7);
});

test("the daily budget holds across runs: a run that would go over stops before calling and says what's left", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adwarp-library-budget-"));
  try {
    const now = () => new Date("2026-11-11T20:00:00Z");
    const budget = () => new DailyCallBudget({ limit: 2, clientId: "library-app", dir, now });
    const ads = { Ramp: Array.from({ length: 60 }, (_, i) => element(`${1000 + i}`, "1406226")), Rippling: Array.from({ length: 10 }, (_, i) => element(`${2000 + i}`, "17988315")) };

    const client = linkedinClient(ads);
    const first = fakeGuard(budget());
    const run1 = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING), checkedAt, max: 500, linkedinSearch: searchWith(client, first.guard), linkedinGuard: first.guard, env: {} });
    assert.equal(client.calls.length, 2);
    assert.equal(run1.stopped.reason, "budget");
    assert.match(run1.stopped.message, /0 calls left; it resets at midnight UTC, in 4h 0m/);
    assert.equal(run1.candidates.length, 50, "Ramp's 2 pages are kept");
    assert.deepEqual(run1.errors, [{ advertiser: "Rippling", message: "Not reached: the run stopped (budget)." }]);
    assert.deepEqual(run1.calls, { made: 2, leftToday: 0, dailyBudget: 2 });

    const again = linkedinClient(ads);
    const second = fakeGuard(budget());
    const run2 = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt, linkedinSearch: searchWith(again, second.guard), linkedinGuard: second.guard, env: {} });
    assert.equal(again.calls.length, 0, "nothing goes out once the day's budget is spent");
    assert.equal(run2.stopped.reason, "budget");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("calls stay 2.2s apart across advertisers in the library path", async () => {
  const client = linkedinClient({ Ramp: [element("1001", "1406226")], Rippling: [element("2001", "17988315")], Notion: [element("3001", "30898036")] });
  const { guard, slept } = fakeGuard();
  await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP, RIPPLING, NOTION), checkedAt, linkedinSearch: searchWith(client, guard), linkedinGuard: guard, env: {} });
  assert.equal(client.calls.length, 3);
  assert.deepEqual(slept, [2200, 2200]);
});

/** A served-during Ad Library (see windows.test.mjs) over windows, counting calls, failing after `budget` calls. */
function monthLibrary(ads, budget = Infinity) {
  const calls = [];
  const search = async (opts) => {
    if (calls.length >= budget) {
      const err = new AdLibraryBudgetError("The daily budget of 3 Ad Library calls for this app is used.", budget, budget);
      err.partial = { fetched: 0, ads: [] };
      throw err;
    }
    calls.push(opts);
    const d = (x) => `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`;
    const [start, end] = [d(opts.dateRange.start), d(opts.dateRange.end)];
    const hits = ads.filter((a) => a.served[0] <= end && a.served[1] >= start);
    return { fetched: hits.length, ads: hits };
  };
  return { search, calls };
}
const servedAd = (id, from, to) => ({
  ...normalizeApiElement(element(id, "1406226")),
  served: [from, to],
});

test("--walk-back resumes where the budget stopped it, and the months add up across runs", async () => {
  const ads = [servedAd("5001", "2025-12-10", "2026-11-09"), servedAd("5002", "2026-01-05", "2026-02-20")];
  const day1 = monthLibrary(ads, 3);
  const run1 = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt, walkBack: { months: 12 }, linkedinSearch: day1.search, env: {} });
  assert.equal(day1.calls.length, 3);
  assert.equal(run1.stopped.reason, "budget");
  const rec = run1.walks.Ramp;
  assert.equal(rec.done, false);
  assert.equal(rec.startedAt, checkedAt);
  assert.equal(rec.remaining.length, 9, "Nov, Oct and Sep were read; Aug back to Dec 2025 remain");
  assert.deepEqual(rec.remaining[0], { start: "2026-08-01", end: "2026-09-01" });
  assert.deepEqual(run1.candidates.find((c) => c.source.adId === "5001").servedMonths, ["2026-09", "2026-10", "2026-11"]);
  assert.equal(run1.candidates.find((c) => c.source.adId === "5001").servedMonthsFloor, "unread", "earlier months weren't read yet");

  const day2 = monthLibrary(ads);
  const run2 = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt: "2026-11-12", walkBack: { months: 12 }, previous: run1, linkedinSearch: day2.search, env: {} });
  assert.equal(day2.calls.length, 9, "only the 9 windows left");
  assert.equal(run2.walks.Ramp.done, true);
  assert.equal(run2.walks.Ramp.startedAt, checkedAt);
  const long = run2.candidates.find((c) => c.source.adId === "5001");
  assert.equal(long.servedMonths.length, 12);
  assert.equal(long.servedMonthsFloor, "lookback");
  assert.deepEqual(run2.candidates.find((c) => c.source.adId === "5002").servedMonths, ["2026-01", "2026-02"]);
  assert.equal(run2.candidates.find((c) => c.source.adId === "5002").servedMonthsFloor, undefined);
});

test("--walk-back skips an advertiser walked back in the last 7 days unless --force", async () => {
  const ads = [servedAd("5001", "2025-12-10", "2026-11-09")];
  const first = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt, walkBack: { months: 12 }, linkedinSearch: monthLibrary(ads).search, env: {} });
  assert.equal(first.walks.Ramp.done, true);

  const soon = monthLibrary(ads);
  const again = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt: "2026-11-15", walkBack: { months: 12 }, previous: first, linkedinSearch: soon.search, env: {} });
  assert.equal(soon.calls.length, 0);
  assert.deepEqual(again.skipped, [{ advertiser: "Ramp", reason: "walked back on 2026-11-11; again after 7 days, or pass --force" }]);
  assert.equal(again.candidates.length, 1, "its ads are kept");
  assert.deepEqual(again.tracked, ["Ramp"]);

  const forced = monthLibrary(ads);
  await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt: "2026-11-15", walkBack: { months: 12 }, previous: first, force: true, linkedinSearch: forced.search, env: {} });
  assert.equal(forced.calls.length, 12);

  const weekLater = monthLibrary(ads);
  await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt: "2026-11-18", walkBack: { months: 12 }, previous: first, linkedinSearch: weekLater.search, env: {} });
  assert.equal(weekLater.calls.length, 12);
});

test("a daily run keeps the walk records and the served months", async () => {
  const ads = [servedAd("5001", "2025-12-10", "2026-11-09")];
  const walked = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt, walkBack: { months: 12 }, linkedinSearch: monthLibrary(ads).search, env: {} });
  const client = linkedinClient({ Ramp: [element("5001", "1406226"), element("5003", "1406226")] });
  const daily = await lib.collect({ platform: "linkedin", watchlist: watchlist(RAMP), checkedAt: "2026-11-12", previous: walked, linkedinSearch: searchWith(client, fakeGuard().guard), env: {} });
  assert.deepEqual(daily.walks, walked.walks);
  assert.equal(daily.candidates.find((c) => c.source.adId === "5001").servedMonths.length, 12);
  assert.ok(daily.candidates.some((c) => c.source.adId === "5003"));
});
