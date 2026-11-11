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
  metricFloor,
  runDays,
} from "./record.js";
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
  /** The floor of the metric, or the days run. */
  strength: number;
  family?: string;
  reason: string;
}

export interface RankOptions {
  /** Shortlist size. Default 25. */
  top?: number;
  /** At most this many ads per advertiser. Default 3. */
  perAdvertiser?: number;
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
  const span = c.firstShown && c.lastShown ? ` from ${formatDay(c.firstShown)} to ${formatDay(c.lastShown)}` : "";
  const live = c.live ? ", still running when checked" : "";
  const rank = size > 1 ? `, ranked ${position} of ${size} tracked ${PLATFORM_LABEL[c.platform]} ads by days run` : "";
  return `Ran ${days} days${span}${live}${rank}.`;
}

export function rankCandidates(candidates: Candidate[], opts: RankOptions = {}): RankReport {
  const top = opts.top ?? 25;
  const perAdvertiser = opts.perAdvertiser ?? 3;
  const ineligible: RankReport["ineligible"] = [];
  const mostSeen = new Map<string, { c: Candidate; metric: AdMetric }[]>();
  const longRun = new Map<string, { c: Candidate; days: number }[]>();

  for (const c of candidates) {
    const evidence = evidenceOf(c);
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
      reason: days === null ? "No exposure metric and no run dates" : `No exposure metric, and ran ${days} days, under ${LONG_RUN_DAYS}`,
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
    for (const { c, days } of items) {
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
