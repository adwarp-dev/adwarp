/**
 * Ranking and the drafts writer: overlapping bands tie, missing metrics never rank, groups never mix geographies,
 * the caps apply after evidence, and a new collection never overwrites an editor's work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const lib = await import("../dist/index.js");
const checkedAt = "2026-11-08";

function candidate(id, { advertiser = "A", metrics = [], firstShown = null, lastShown = null, live = null, copy = null, refs = [], platform = "linkedin" } = {}) {
  return {
    platform,
    source: { type: "linkedin-ad-library", adId: id, url: `https://www.linkedin.com/ad-library/detail/${id}`, route: "official-api" },
    advertiser: { name: advertiser, platformId: "1" },
    category: "B2B SaaS",
    format: "single-image",
    copy,
    creativeRefs: refs,
    firstShown,
    lastShown,
    live,
    regions: ["DE"],
    metrics,
    notes: [],
    checkedAt,
  };
}

const band = (lower, upper, geography = "total") => ({
  name: "impressions", kind: "range", lower, ...(upper !== undefined ? { upper } : {}), text: `${lower}-${upper ?? ""}`, geography, period: "lifetime", source: "LinkedIn Ad Library API", collectedAt: checkedAt,
});

test("overlapping bands tie instead of getting a precise order", () => {
  const report = lib.rankCandidates([
    candidate("1", { advertiser: "A", metrics: [band(100000, 200000)] }),
    candidate("2", { advertiser: "B", metrics: [band(150000, 300000)] }),
    candidate("3", { advertiser: "C", metrics: [band(20000, 30000)] }),
  ]);
  const byId = Object.fromEntries(report.shortlist.map((r) => [r.candidate.source.adId, r]));
  assert.equal(byId["2"].position, 1);
  assert.equal(byId["1"].position, 1, "100k-200k overlaps 150k-300k, so neither is certainly ahead");
  assert.equal(byId["1"].tiedWith, 1);
  assert.equal(byId["3"].position, 3);
  assert.match(byId["3"].reason, /^20000-30000 impressions in total, ranked 3 of 3 tracked LinkedIn ads with the same measure\.$/);
  assert.match(byId["1"].reason, /level with 1 other whose ranges overlap/);
});

test("ads without an exposure metric never rank as most seen; long runs and the rest are separated", () => {
  const report = lib.rankCandidates([
    candidate("m", { metrics: [band(1000, 5000)] }),
    candidate("long", { advertiser: "B", firstShown: "2026-08-01", lastShown: "2026-11-07", live: true }),
    candidate("short", { advertiser: "C", firstShown: "2026-11-01", lastShown: "2026-11-07" }),
    candidate("none", { advertiser: "D" }),
  ]);
  assert.deepEqual(report.shortlist.map((r) => [r.candidate.source.adId, r.collection]), [["m", "most-seen"], ["long", "long-running"]]);
  assert.match(report.shortlist[1].reason, /^Ran 99 days from Aug 1, 2026 to Nov 7, 2026, still running when checked\.$/);
  assert.deepEqual(report.ineligible.map((i) => [i.adId, i.reason]), [
    ["short", "No exposure metric, and ran 7 days, under 30"],
    ["none", "No exposure metric and no run dates"],
  ]);
});

test("different geographies are different groups", () => {
  const report = lib.rankCandidates([
    candidate("de", { metrics: [band(1000, 2000, "DE")] }),
    candidate("fr", { advertiser: "B", metrics: [band(1, 2, "FR")] }),
  ]);
  assert.equal(report.groups.length, 2);
  assert.ok(report.shortlist.every((r) => r.position === 1 && r.groupSize === 1));
});

test("caps apply after evidence: per advertiser, 1 per creative family, and the shortlist size", () => {
  const same = { intro: "Same words", headline: "Same" };
  const report = lib.rankCandidates(
    [
      candidate("a1", { advertiser: "A", metrics: [band(900, 1000)] }),
      candidate("a2", { advertiser: "A", metrics: [band(800, 899)] }),
      candidate("a3", { advertiser: "A", metrics: [band(700, 799)] }),
      candidate("b1", { advertiser: "B", metrics: [band(600, 699)], copy: same }),
      candidate("b2", { advertiser: "B", metrics: [band(500, 599)], copy: { ...same, intro: "same   WORDS" } }),
      candidate("c1", { advertiser: "C", metrics: [band(400, 499)] }),
    ],
    { perAdvertiser: 2, top: 4 },
  );
  assert.deepEqual(report.shortlist.map((r) => r.candidate.source.adId), ["a1", "a2", "b1", "c1"]);
  assert.equal(report.leftOut, 2);
});

test("drafts: a new record is media_pending, passes the record rules and quotes copy verbatim", () => {
  const c = candidate("1599585996", {
    advertiser: "monday.com",
    metrics: [band(100000, 200000)],
    live: true,
    copy: { intro: "Work — without the chaos 🚀" },
  });
  const [ranked] = lib.rankCandidates([c]).shortlist;
  const record = lib.newRecord(ranked);
  assert.equal(record.slug, "monday-com-linkedin-single-image-1599585996");
  assert.equal(record.status, "media_pending");
  assert.equal(record.writeup, null);
  assert.equal(record.creative.display, "drawn");
  assert.deepEqual(record.evidence.observations, [{ at: checkedAt, live: true }]);
  assert.equal(record.copy.intro, "Work — without the chaos 🚀");
  assert.doesNotThrow(() => lib.parseAdRecord(JSON.parse(lib.serializeRecord(record)), record.slug));
});

test("drafts: merging keeps the editor's fields, fills copy only while null, and appends observations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adwarp-library-"));
  try {
    const first = lib.newRecord(lib.rankCandidates([candidate("42", { metrics: [band(1000, 5000)], live: true })]).shortlist[0]);
    assert.equal((await lib.writeDrafts([first], { dir }))[0].action, "created");

    // The editor inspects the ad and writes it up.
    const path = join(dir, `${first.slug}.json`);
    const edited = JSON.parse(await readFile(path, "utf8"));
    edited.status = "draft";
    delete edited.statusNote;
    edited.copy = { headline: "Typed in by the editor" };
    edited.creative = { display: "drawn", ratio: "1:1" };
    edited.selection.reason = "The editor's own words.";
    edited.writeup = { title: "A clear title", summary: "What it does.", hook: "h", problem: null, offer: null, proof: null, cta: "Learn more", testIdea: "Try it.", missing: ["Spend"] };
    await writeFile(path, JSON.stringify(edited, null, 2));

    // A week later the collector sees a bigger band and copy from the source.
    const later = { ...candidate("42", { metrics: [band(5000, 10000)], live: true, copy: { headline: "From the source" } }), checkedAt: "2026-11-15" };
    later.metrics = [{ ...later.metrics[0], collectedAt: "2026-11-15" }];
    const fresh = lib.newRecord(lib.rankCandidates([later]).shortlist[0]);
    const [outcome] = await lib.writeDrafts([fresh], { dir });
    assert.equal(outcome.action, "updated");

    const merged = JSON.parse(await readFile(path, "utf8"));
    assert.equal(merged.status, "draft");
    assert.equal(merged.selection.reason, "The editor's own words.");
    assert.equal(merged.writeup.title, "A clear title");
    assert.deepEqual(merged.copy, { headline: "Typed in by the editor" });
    assert.deepEqual(merged.creative, { display: "drawn", ratio: "1:1" });
    assert.equal(merged.evidence.metrics[0].lower, 5000);
    assert.equal(merged.evidence.checkedAt, "2026-11-15");
    assert.deepEqual(merged.evidence.observations, [{ at: checkedAt, live: true }, { at: "2026-11-15", live: true }]);

    // Running the same collection again changes nothing.
    assert.equal((await lib.writeDrafts([fresh], { dir }))[0].action, "unchanged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drafts: an unreadable file and a merge that breaks the rules are left untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adwarp-library-"));
  try {
    const record = lib.newRecord(lib.rankCandidates([candidate("7", { metrics: [band(1, 2)] })]).shortlist[0]);
    const path = join(dir, `${record.slug}.json`);
    await writeFile(path, "{ not json");
    const [bad] = await lib.writeDrafts([record], { dir });
    assert.equal(bad.action, "skipped");
    assert.equal(await readFile(path, "utf8"), "{ not json");

    // A most-seen record whose metric disappears in the next pull can't stay most-seen, so the file is kept.
    await rm(path);
    await lib.writeDrafts([record], { dir });
    const before = await readFile(path, "utf8");
    const noMetric = { ...record, evidence: { ...record.evidence, metrics: [] } };
    const [skipped] = await lib.writeDrafts([noMetric], { dir });
    assert.equal(skipped.action, "skipped");
    assert.match(skipped.reason, /most-seen needs an exposure metric/);
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("drafts: a dry run writes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adwarp-library-"));
  try {
    const record = lib.newRecord(lib.rankCandidates([candidate("8", { metrics: [band(1, 2)] })]).shortlist[0]);
    const [o] = await lib.writeDrafts([record], { dir, dryRun: true });
    assert.equal(o.action, "created");
    await assert.rejects(readFile(join(dir, `${record.slug}.json`)), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("record rules from the website: estimate needs a value, relative never gets one", () => {
  const record = lib.newRecord(lib.rankCandidates([candidate("9", { metrics: [band(1, 2)] })]).shortlist[0]);
  const withMetric = (m) => ({ ...record, evidence: { ...record.evidence, metrics: [m] } });
  const base = { name: "reach", text: "11K", geography: "DE", period: "lifetime", source: "s", collectedAt: checkedAt };
  assert.throws(() => lib.parseAdRecord(withMetric({ ...base, kind: "estimate" }), record.slug), /an estimate metric needs value/);
  assert.doesNotThrow(() => lib.parseAdRecord(withMetric({ ...base, kind: "estimate", value: 11000 }), record.slug));
  assert.throws(() => lib.parseAdRecord(withMetric({ ...base, kind: "relative", value: 3 }), record.slug), /keeps its words in text/);
  assert.throws(() => lib.parseAdRecord({ ...record, statusNote: "A note — with a dash" }, record.slug), /em dash/);
});
