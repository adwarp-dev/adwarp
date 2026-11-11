/**
 * Picks the shortlist a collection run turns into drafts. Ranking only ever compares like with like:
 *
 * - most-seen: ads with an exposure metric (record.ts exposureMetric), grouped by platform, metric, geography and
 *   period, and sorted by metricFloor so this package and adwarp.dev sort the same way. Ranges that overlap are
 *   ties, never a precise order: an ad's position counts only the ads whose floor is above its ceiling.
 * - long-running: the rest, when runDays reaches LONG_RUN_DAYS, sorted by days run.
 * - Everything else is reported as ineligible. It can still be an editor's pick, added by ID.
 *
 * Diversity comes after evidence: a cap per advertiser and 1 ad per creative family. Near-identical ads share a
 * family, and their metrics are never added together.
 */
import { createHash } from "node:crypto";
import {
  type AdCollection,
  type AdEvidence,
  type AdMetric,
  type AdPlatform,
  exposureMetric,
  LONG_RUN_DAYS,
  daysBetween,
  metricFloor,
  runDays,
} from "./record.js";
import { addDays } from "./parse.js";
import type { Candidate } from "./types.js";

export interface Ranked {
  candidate: Candidate;
  collection: Exclude<AdCollection, "top-ads">;
  /** The comparison group: platform, metric, geography and period, or platform and "run". */
  group: string;
  groupSize: number;
  /** 1 plus the ads in the group that are certainly ahead. Overlapping bands share a position. */
  position: number;
  /** Other ads in the group whose bands overlap this one. */
  tiedWith: number;
  /** The floor of the metric, or the days run (a minimum when it comes from served months). */
  strength: number;
  /**
   * True when the run comes only from the months LinkedIn's date filter lists the ad as served in. The website's
   * record format can't hold that evidence yet, so drafts ranks these ads but doesn't write them.
   */
  runFromMonths?: boolean;
  family?: string;
  reason: string;
}

export interface RankOptions {
  /** Shortlist size. Default 25. */
  top?: number;
  /** At most this many ads per advertiser. Default 3. */
  perAdvertiser?: number;
  /**
   * evidence (default): most seen first, then long running. run: every ad with run evidence ranked by days run,
   * exposure numbers aside, including the run LinkedIn's served months give ads with no EU dates.
   */
  by?: "evidence" | "run";
}

export interface RankReport {
  shortlist: Ranked[];
  groups: { group: string; size: number }[];
  ineligible: { adId: string; advertiser: string; reason: string }[];
  /** Eligible ads left out by the diversity caps or the shortlist size. */
  leftOut: number;
}

export const PLATFORM_LABEL: Record<AdPlatform, string> = { linkedin: "LinkedIn", google: "Google", meta: "Meta", tiktok: "TikTok" };

const METRIC_WORDS: Record<string, string> = {
  impressions: "impressions",
  reach: "people reached",
  "times-shown": "times shown",
  "unique-users-seen": "unique users",
};

/** "total" reads "in total", "EU" reads "in the EU", a country code reads "in DE". */
export function geographyPhrase(geography: string): string {
  if (geography === "total") return "in total";
  if (geography === "EU" || geography === "EEA" || geography === "UK") return `in the ${geography}`;
  return `in ${geography}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-02" reads "Feb 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const nextMonth = (month: string): string => {
  const [y = 0, m = 1] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const monthsSpanned = (first: string, last: string): number => {
  const [y1 = 0, m1 = 1] = first.split("-").map(Number);
  const [y2 = 0, m2 = 1] = last.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
};

/**
 * The fewest days an ad served in these months can have run: from the last day of the first month to the first day
 * of the last. Served-during gives no day inside a month, so this is a floor. 1 for a single month.
 */
export function servedMonthsMinDays(months: string[]): number | null {
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return null;
  if (first === last) return 1;
  const endOfFirst = addDays(`${nextMonth(first)}-01`, -1);
  return daysBetween(endOfFirst, `${last}-01`) + 1;
}

/** The run the evidence shows: exact from dates, a minimum from served months, or null. */
export function candidateRun(c: Candidate): { days: number; from: "dates" } | { days: number; from: "months" } | null {
  if (c.firstShown && c.lastShown) {
    const days = runDays(evidenceOf(c));
    return days === null ? null : { days, from: "dates" };
  }
  const days = servedMonthsMinDays(c.servedMonths ?? []);
  return days === null ? null : { days, from: "months" };
}
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

/** The candidate's evidence in the record's shape, so the record's own rules decide eligibility. */
export function evidenceOf(c: Candidate): AdEvidence {
  return {
    checkedAt: c.checkedAt,
    firstShown: c.firstShown,
    lastShown: c.lastShown,
    live: c.live,
    regions: c.regions,
    metrics: c.metrics,
    notes: c.notes,
  };
}

/** A fingerprint shared by near-identical ads: same copy (case and spacing aside) and the same media. */
export function creativeFamily(c: Candidate): string | undefined {
  const words = c.copy
    ? [c.copy.intro, c.copy.headline, c.copy.body, c.copy.cta].filter(Boolean).join(" | ").toLowerCase().replace(/\s+/g, " ").trim()
    : "";
  const media = [...c.creativeRefs].sort().join(" ");
  if (!words && !media) return undefined;
  return createHash("sha256").update(`${c.platform}\n${words}\n${media}`).digest("hex").slice(0, 16);
}

const ceiling = (m: AdMetric): number => (m.kind === "range" ? (m.upper ?? Number.POSITIVE_INFINITY) : (metricFloor(m) ?? 0));

function mostSeenReason(metric: AdMetric, c: Candidate, position: number, size: number, tied: number): string {
  const what = `${metric.text} ${METRIC_WORDS[metric.name] ?? metric.name} ${geographyPhrase(metric.geography)}`;
  const where = `${size} tracked ${PLATFORM_LABEL[c.platform]} ads with the same measure`;
  const tie = tied ? `, level with ${tied} other${tied === 1 ? "" : "s"} whose ranges overlap` : "";
  // A group of 1 has no ranking to report.
  return size > 1 ? `${what}, ranked ${position} of ${where}${tie}.` : `${what}.`;
}

function longRunReason(c: Candidate, days: number, position: number, size: number): string {
  const rank = size > 1 ? `, ranked ${position} of ${size} tracked ${PLATFORM_LABEL[c.platform]} ads by days run` : "";
  if (!(c.firstShown && c.lastShown) && c.servedMonths?.length) return servedMonthsReason(c, days, rank);
  const span = c.firstShown && c.lastShown ? ` from ${formatDay(c.firstShown)} to ${formatDay(c.lastShown)}` : "";
  const live = c.live ? ", still running when checked" : "";
  return `Ran ${days} days${span}${live}${rank}.`;
}

/**
 * The run of an ad LinkedIn gives no dates for, in words: where it comes from (the months the date filter lists it
 * as served in) and, when the first month is a floor, why.
 */
export function servedMonthsReason(c: Candidate, days: number, rank = ""): string {
  const months = c.servedMonths ?? [];
  const first = months[0] ?? "";
  const last = months[months.length - 1] ?? "";
  const spanned = monthsSpanned(first, last);
  const which =
    months.length === 1
      ? `in ${formatMonth(first)}`
      : months.length === spanned
        ? `in ${months.length} months, ${formatMonth(first)} to ${formatMonth(last)}`
        : `in ${months.length} of the ${spanned} months from ${formatMonth(first)} to ${formatMonth(last)}`;
  const floor =
    c.servedMonthsFloor === "lookback"
      ? `, and ${formatMonth(first)} is a floor because the filter reaches back only 12 months`
      : c.servedMonthsFloor === "unread"
        ? `, and it may have started before ${formatMonth(first)} because an earlier month wasn't read in full`
        : "";
  return `Ran at least ${days} day${days === 1 ? "" : "s"}: LinkedIn's date filter lists it as served ${which}${floor}${rank}.`;
}

export function rankCandidates(candidates: Candidate[], opts: RankOptions = {}): RankReport {
  const top = opts.top ?? 25;
  const perAdvertiser = opts.perAdvertiser ?? 3;
  const ineligible: RankReport["ineligible"] = [];
  const mostSeen = new Map<string, { c: Candidate; metric: AdMetric }[]>();
  const longRun = new Map<string, { c: Candidate; days: number; fromMonths?: boolean }[]>();

  for (const c of candidates) {
    const evidence = evidenceOf(c);
    if (opts.by === "run") {
      const run = candidateRun(c);
      if (run && run.days >= LONG_RUN_DAYS) {
        const key = `${c.platform} run`;
        longRun.set(key, [...(longRun.get(key) ?? []), { c, days: run.days, fromMonths: run.from === "months" }]);
      } else
        ineligible.push({
          adId: c.source.adId,
          advertiser: c.advertiser.name,
          reason: run ? `Ran ${run.from === "months" ? "at least " : ""}${run.days} days, under ${LONG_RUN_DAYS}` : "No run dates and no served months",
        });
      continue;
    }
    const metric = exposureMetric(evidence);
    if (metric) {
      const key = `${c.platform} ${metric.name} ${metric.geography} ${metric.period}`;
      mostSeen.set(key, [...(mostSeen.get(key) ?? []), { c, metric }]);
      continue;
    }
    const days = runDays(evidence);
    if (days !== null && days >= LONG_RUN_DAYS) {
      const key = `${c.platform} run`;
      longRun.set(key, [...(longRun.get(key) ?? []), { c, days }]);
      continue;
    }
    ineligible.push({
      adId: c.source.adId,
      advertiser: c.advertiser.name,
      reason:
        days === null
          ? c.servedMonths?.length
            ? `No exposure metric or run dates; served in ${c.servedMonths.length} months by LinkedIn's date filter (rank it with --rank-by run)`
            : "No exposure metric and no run dates"
          : `No exposure metric, and ran ${days} days, under ${LONG_RUN_DAYS}`,
    });
  }

  const ranked: Ranked[] = [];
  for (const [group, items] of mostSeen) {
    items.sort((a, b) => (metricFloor(b.metric) ?? 0) - (metricFloor(a.metric) ?? 0) || ceiling(b.metric) - ceiling(a.metric));
    for (const { c, metric } of items) {
      const floor = metricFloor(metric) ?? 0;
      const ceil = ceiling(metric);
      const ahead = items.filter((o) => (metricFloor(o.metric) ?? 0) > ceil).length;
      const tied = items.filter((o) => o.c !== c && (metricFloor(o.metric) ?? 0) <= ceil && ceiling(o.metric) >= floor).length;
      const position = ahead + 1;
      const family = creativeFamily(c);
      ranked.push({
        candidate: c,
        collection: "most-seen",
        group,
        groupSize: items.length,
        position,
        tiedWith: tied,
        strength: floor,
        ...(family ? { family } : {}),
        reason: mostSeenReason(metric, c, position, items.length, tied),
      });
    }
  }
  for (const [group, items] of longRun) {
    items.sort((a, b) => b.days - a.days);
    for (const { c, days, fromMonths } of items) {
      const position = items.filter((o) => o.days > days).length + 1;
      const tied = items.filter((o) => o.c !== c && o.days === days).length;
      const family = creativeFamily(c);
      ranked.push({
        candidate: c,
        collection: "long-running",
        group,
        groupSize: items.length,
        position,
        tiedWith: tied,
        strength: days,
        ...(fromMonths ? { runFromMonths: true } : {}),
        ...(family ? { family } : {}),
        reason: longRunReason(c, days, position, items.length),
      });
    }
  }

  // Evidence first: most-seen by position then floor, then long-running by days.
  ranked.sort((a, b) => {
    if (a.collection !== b.collection) return a.collection === "most-seen" ? -1 : 1;
    return a.position - b.position || b.strength - a.strength;
  });

  const shortlist: Ranked[] = [];
  const perAd = new Map<string, number>();
  const families = new Set<string>();
  for (const r of ranked) {
    if (shortlist.length >= top) break;
    const n = perAd.get(r.candidate.advertiser.name) ?? 0;
    if (n >= perAdvertiser) continue;
    if (r.family && families.has(r.family)) continue;
    shortlist.push(r);
    perAd.set(r.candidate.advertiser.name, n + 1);
    if (r.family) families.add(r.family);
  }

  const groups = [
    ...[...mostSeen].map(([group, items]) => ({ group, size: items.length })),
    ...[...longRun].map(([group, items]) => ({ group, size: items.length })),
  ];
  return { shortlist, groups, ineligible, leftOut: ranked.length - shortlist.length };
}
