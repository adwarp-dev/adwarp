/**
 * New-ad detection between 2 runs and the alert. Only launches by advertisers already tracked are news; older ads
 * found late, new advertisers and advertisers that failed today never trigger an alert, and nothing posts when
 * nothing launched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeFetch } from "./helpers.mjs";

const lib = await import("../dist/index.js");

const cand = (id, advertiser, firstShown, format = "single-image") => ({
  platform: "linkedin",
  source: { type: "linkedin-ad-library", adId: id, url: `https://www.linkedin.com/ad-library/detail/${id}`, route: "official-api" },
  advertiser: { name: advertiser, platformId: "1" },
  category: "B2B SaaS",
  format,
  copy: null,
  creativeRefs: [],
  firstShown,
  lastShown: firstShown,
  live: null,
  regions: [],
  metrics: [],
  notes: [],
  checkedAt: "2026-11-11",
});
const run = (collectedAt, candidates, extra = {}) => ({
  version: 1,
  platform: "linkedin",
  collectedAt,
  query: { max: 100 },
  candidates,
  skipped: [],
  errors: [],
  ...extra,
});

const previous = run("2026-11-10", [cand("1", "Ramp", "2026-11-05"), cand("2", "Rippling", "2026-10-01"), cand("3", "Notion", "2026-09-01")], {
  tracked: ["Ramp", "Rippling", "Notion", "Quiet Co"],
});

test("launches by tracked advertisers are new; old finds, new advertisers and failures are not", () => {
  const current = run(
    "2026-11-11",
    [
      cand("1", "Ramp", "2026-11-05"),
      cand("10", "Ramp", "2026-11-11", "video"),
      cand("11", "Ramp", "2026-11-10"),
      cand("12", "Ramp", null),
      cand("20", "Rippling", "2026-06-01"), // first seen today, but running since June: found late
      cand("30", "Quiet Co", "2026-11-11"), // tracked yesterday with 0 ads, launched today
      cand("40", "Brand New", "2026-11-11"), // added to the watchlist today
    ],
    { tracked: ["Ramp", "Rippling", "Quiet Co", "Brand New"], errors: [{ advertiser: "Notion", message: "LinkedIn answered 500" }] },
  );
  const report = lib.newAdsSince(previous, current);
  assert.deepEqual(
    report.launched.map((g) => [g.advertiser, g.ads.map((a) => a.adId), g.maybeMore]),
    [
      ["Ramp", ["10", "11", "12"], false],
      ["Quiet Co", ["30"], false],
    ],
  );
  assert.deepEqual(report.launched[0].ads[0], { adId: "10", advertiser: "Ramp", format: "video", firstShown: "2026-11-11", url: "https://www.linkedin.com/ad-library/detail/10" });
  assert.deepEqual(report.foundLate.map((a) => a.adId), ["20"]);
  assert.deepEqual(report.baseline, ["Brand New"]);

  const carried = lib.carryForward(previous, current);
  assert.deepEqual(carried.carried, ["Notion"]);
  assert.ok(carried.file.candidates.some((c) => c.source.adId === "3"), "Notion keeps yesterday's ads");
  assert.ok(carried.file.tracked.includes("Notion"), "and stays tracked, so its next launch still alerts");
});

test("an advertiser whose whole pull is new and hit the limit may have more", () => {
  const current = run("2026-11-11", [cand("a", "Ramp", "2026-11-11"), cand("b", "Ramp", "2026-11-11")], { query: { max: 2 }, tracked: ["Ramp"] });
  const [group] = lib.newAdsSince(previous, current).launched;
  assert.equal(group.maybeMore, true);
  assert.match(lib.alertText(lib.newAdsSince(previous, current)), /Ramp: 2 new \(the pull hit its limit, so there may be more\)/);
});

test("the alert is plain text with format, first shown date and link, and caps each advertiser's list", () => {
  const many = Array.from({ length: 12 }, (_, i) => cand(`m${i}`, "Ramp", `2026-11-${String(i < 6 ? 11 : 10)}`));
  const current = run("2026-11-11", [...many, cand("r1", "Rippling", null, "document")], { tracked: ["Ramp", "Rippling"] });
  const text = lib.alertText(lib.newAdsSince(previous, current), 10);
  const lines = text.split("\n");
  assert.equal(lines[0], "Adwarp ad library: 13 new LinkedIn ads from 2 advertisers since Nov 10, 2026.");
  assert.ok(lines.includes("Ramp: 12 new"));
  assert.ok(lines.includes("- single image, first shown Nov 11, 2026: https://www.linkedin.com/ad-library/detail/m0"));
  assert.ok(lines.includes("- and 2 more"));
  assert.ok(lines.includes("Rippling: 1 new"));
  assert.ok(lines.includes("- document, no first shown date: https://www.linkedin.com/ad-library/detail/r1"));
  assert.ok(!/[–—]/.test(text), "no en or em dashes");

  const one = lib.alertText(lib.newAdsSince(previous, run("2026-11-11", [cand("z", "Ramp", "2026-11-11")], { tracked: ["Ramp"] })));
  assert.equal(one.split("\n")[0], "Adwarp ad library: 1 new LinkedIn ad from 1 advertiser since Nov 10, 2026.");
});

test("nothing new means no alert text, and the summary still says so", () => {
  const same = run("2026-11-11", previous.candidates, { tracked: previous.tracked });
  const report = lib.newAdsSince(previous, same);
  assert.equal(lib.alertText(report), null);
  assert.equal(lib.changesSummary(report), "No new LinkedIn ads since Nov 10, 2026.");
});

test("a previous file without tracked counts the advertisers it has ads for", () => {
  const old = { ...previous, tracked: undefined };
  const report = lib.newAdsSince(old, run("2026-11-11", [cand("q", "Quiet Co", "2026-11-11")], { tracked: ["Quiet Co"] }));
  assert.deepEqual(report.baseline, ["Quiet Co"]);
  assert.equal(lib.alertText(report), null);
});

test("runs of different platforms can't be compared", () => {
  assert.throws(() => lib.newAdsSince(previous, { ...run("2026-11-11", []), platform: "meta" }), /same platform/);
});

test("the webhook gets {text}, and a failure never shows its secret URL", async () => {
  const ok = fakeFetch(() => ({ body: "ok" }));
  await lib.postAlert("https://hooks.example.com/services/T0/B0/SECRET", "hello", ok);
  assert.equal(ok.calls[0].init.method, "POST");
  assert.equal(ok.calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(ok.calls[0].init.body), { text: "hello" });

  const bad = fakeFetch(() => ({ status: 404, body: "no_service" }));
  await assert.rejects(lib.postAlert("https://hooks.example.com/services/T0/B0/SECRET", "hello", bad), (err) => {
    assert.equal(err.message, "The alert webhook answered 404.");
    return true;
  });
  const down = async () => {
    throw new Error("connect ECONNREFUSED https://hooks.example.com/services/T0/B0/SECRET");
  };
  await assert.rejects(lib.postAlert("https://hooks.example.com/services/T0/B0/SECRET", "hello", down), (err) => !err.message.includes("SECRET"));
});

test("compareWithPrevious: the first run is a baseline, later runs carry a report and save it in the file", () => {
  const today = run("2026-11-11", [cand("1", "Ramp", "2026-11-05"), cand("9", "Ramp", "2026-11-11")], { tracked: ["Ramp"] });
  assert.deepEqual(lib.compareWithPrevious(undefined, today), { file: today });
  const { file, report } = lib.compareWithPrevious(previous, today);
  assert.deepEqual(report.launched.map((g) => g.ads.map((a) => a.adId)), [["9"]]);
  assert.equal(file.changes, report);
  assert.equal(file.candidates.length, 2);
});

test("sendAlert posts only when something launched and a webhook is set", async () => {
  const hook = fakeFetch(() => ({ body: "ok" }));
  const env = { ADWARP_LIBRARY_ALERT_WEBHOOK: "https://hooks.example.com/services/T0/B0/SECRET" };
  const quiet = lib.newAdsSince(previous, run("2026-11-11", previous.candidates, { tracked: previous.tracked }));
  assert.equal(await lib.sendAlert(quiet, env, hook), "nothing");
  assert.equal(hook.calls.length, 0, "never posts when nothing is new");

  const news = lib.newAdsSince(previous, run("2026-11-11", [cand("9", "Ramp", "2026-11-11")], { tracked: ["Ramp"] }));
  assert.equal(await lib.sendAlert(news, {}, hook), "printed");
  assert.equal(hook.calls.length, 0, "no webhook, no post");
  assert.equal(await lib.sendAlert(news, env, hook), "posted");
  assert.equal(hook.calls.length, 1);
  assert.match(JSON.parse(hook.calls[0].init.body).text, /^Adwarp ad library: 1 new LinkedIn ad from 1 advertiser/);
  assert.ok(!hook.calls[0].init.body.includes("SECRET"), "the message never carries the webhook URL");
});
