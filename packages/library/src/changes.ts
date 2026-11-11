/**
 * New-ad detection between 2 collection runs of the same platform, and the plain-text alert for it.
 *
 * An ad is new when its ID wasn't in the previous run. It counts as a launch, and goes in the alert, only when:
 * - its advertiser was tracked in the previous run (an advertiser added to the watchlist since is a baseline, so its
 *   first pull never floods the alert), and
 * - it wasn't first shown well before the previous run (an older ad found for the first time, by a bigger --max or
 *   --walk-back, is listed as found late instead).
 * Advertisers that failed this run keep their previous ads, so a 1-day outage doesn't turn every ad into news the
 * day after.
 */
import { addDays } from "./parse.js";
import { formatDay, PLATFORM_LABEL } from "./rank.js";
import type { AdFormat, AdPlatform } from "./record.js";
import type { Candidate, CandidatesFile, FetchLike } from "./types.js";

export interface NewAd {
  adId: string;
  advertiser: string;
  format: AdFormat;
  firstShown: string | null;
  url: string;
}

export interface NewAdsReport {
  platform: AdPlatform;
  previousCollectedAt: string;
  collectedAt: string;
  /** Launches since the previous run, per advertiser, newest first. */
  launched: { advertiser: string; ads: NewAd[]; maybeMore: boolean }[];
  /** New to us, but first shown before the previous run. */
  foundLate: NewAd[];
  /** Advertisers with no previous pull: their ads are the starting point, not news. */
  baseline: string[];
  /** Advertisers that failed this run and kept their previous ads. */
  carriedForward: string[];
}

const toNewAd = (c: Candidate): NewAd => ({
  adId: c.source.adId,
  advertiser: c.advertiser.name,
  format: c.format,
  firstShown: c.firstShown,
  url: c.source.url,
});

/** The advertisers a run pulled successfully. Older files without `tracked` count those with at least 1 ad. */
export function trackedIn(file: CandidatesFile): Set<string> {
  if (file.tracked) return new Set(file.tracked);
  return new Set(file.candidates.map((c) => c.advertiser.name));
}

/** The current run plus the previous ads of every advertiser that failed this time. */
export function carryForward(previous: CandidatesFile, current: CandidatesFile): { file: CandidatesFile; carried: string[] } {
  const failed = new Set(current.errors.map((e) => e.advertiser));
  const have = new Set(current.candidates.map((c) => c.source.adId));
  const kept = previous.candidates.filter((c) => failed.has(c.advertiser.name) && !have.has(c.source.adId));
  const carried = [...new Set(kept.map((c) => c.advertiser.name))];
  // They stay tracked, so their next launches still count as news.
  const tracked = [...new Set([...(current.tracked ?? []), ...carried])];
  return { file: { ...current, tracked, candidates: [...current.candidates, ...kept] }, carried };
}

/**
 * Compares 2 runs. `max` is the per-advertiser limit the current run used: an advertiser whose every pulled ad is
 * new and who hit the limit may have launched more than the pull could see.
 */
export function newAdsSince(previous: CandidatesFile, current: CandidatesFile, opts: { max?: number } = {}): NewAdsReport {
  if (previous.platform !== current.platform)
    throw new Error(`The previous file is ${previous.platform} and this run is ${current.platform}; compare runs of the same platform.`);
  const seen = new Set(previous.candidates.map((c) => c.source.adId));
  const tracked = trackedIn(previous);
  const failed = new Set(current.errors.map((e) => e.advertiser));
  const cutoff = addDays(previous.collectedAt, -1);
  const max = opts.max ?? current.query.max;

  const byAdvertiser = new Map<string, NewAd[]>();
  const foundLate: NewAd[] = [];
  const baseline = new Set<string>();
  const pulled = new Map<string, number>();
  for (const c of current.candidates) {
    if (failed.has(c.advertiser.name)) continue;
    pulled.set(c.advertiser.name, (pulled.get(c.advertiser.name) ?? 0) + 1);
    if (seen.has(c.source.adId)) continue;
    if (!tracked.has(c.advertiser.name)) {
      baseline.add(c.advertiser.name);
      continue;
    }
    if (c.firstShown && c.firstShown < cutoff) {
      foundLate.push(toNewAd(c));
      continue;
    }
    byAdvertiser.set(c.advertiser.name, [...(byAdvertiser.get(c.advertiser.name) ?? []), toNewAd(c)]);
  }
  const launched = [...byAdvertiser]
    .map(([advertiser, ads]) => ({
      advertiser,
      // Newest first; ads without a date (served outside the EU) last.
      ads: ads.sort((a, b) => (b.firstShown ?? "").localeCompare(a.firstShown ?? "")),
      maybeMore: ads.length >= (pulled.get(advertiser) ?? 0) && (pulled.get(advertiser) ?? 0) >= max,
    }))
    .sort((a, b) => b.ads.length - a.ads.length || a.advertiser.localeCompare(b.advertiser));
  return {
    platform: current.platform,
    previousCollectedAt: previous.collectedAt,
    collectedAt: current.collectedAt,
    launched,
    foundLate,
    baseline: [...baseline],
    carriedForward: [],
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const FORMAT_LABEL: Partial<Record<AdFormat, string>> = { "single-image": "single image", "thought-leader": "thought leader" };

/** The alert as plain text, or null when nothing launched. Lists up to `perAdvertiser` ads per advertiser. */
export function alertText(report: NewAdsReport, perAdvertiser = 10): string | null {
  const total = report.launched.reduce((n, a) => n + a.ads.length, 0);
  if (!total) return null;
  const platform = PLATFORM_LABEL[report.platform];
  const lines = [
    `Adwarp ad library: ${plural(total, `new ${platform} ad`)} from ${plural(report.launched.length, "advertiser")} since ${formatDay(report.previousCollectedAt)}.`,
  ];
  for (const group of report.launched) {
    lines.push("", `${group.advertiser}: ${group.ads.length} new${group.maybeMore ? " (the pull hit its limit, so there may be more)" : ""}`);
    for (const ad of group.ads.slice(0, perAdvertiser)) {
      const format = FORMAT_LABEL[ad.format] ?? ad.format;
      const when = ad.firstShown ? `first shown ${formatDay(ad.firstShown)}` : "no first shown date";
      lines.push(`- ${format}, ${when}: ${ad.url}`);
    }
    if (group.ads.length > perAdvertiser) lines.push(`- and ${group.ads.length - perAdvertiser} more`);
  }
  return lines.join("\n");
}

/** A short summary for the terminal, also when nothing is new. */
export function changesSummary(report: NewAdsReport): string {
  const parts = [alertText(report) ?? `No new ${PLATFORM_LABEL[report.platform]} ads since ${formatDay(report.previousCollectedAt)}.`];
  if (report.foundLate.length) parts.push(`${plural(report.foundLate.length, "older ad")} found for the first time (first shown before the last run), not counted as new.`);
  if (report.baseline.length) parts.push(`Started tracking ${report.baseline.join(", ")}: their ads are the baseline.`);
  if (report.carriedForward.length) parts.push(`${report.carriedForward.join(", ")} failed this run and kept the last run's ads.`);
  return parts.join("\n\n");
}

/**
 * Applies a previous run to this one: the report of what is new, and the file to save, with the previous ads of any
 * advertiser that failed carried forward. Without a previous run (the first one) there is no report.
 */
export function compareWithPrevious(previous: CandidatesFile | undefined, current: CandidatesFile): { file: CandidatesFile; report?: NewAdsReport } {
  if (!previous) return { file: current };
  const report = newAdsSince(previous, current);
  const carried = carryForward(previous, current);
  report.carriedForward = carried.carried;
  return { file: { ...carried.file, changes: report }, report };
}

/**
 * Sends the alert for a report: posted to ADWARP_LIBRARY_ALERT_WEBHOOK when it is set, printed only otherwise, and
 * nothing at all when nothing launched.
 */
export async function sendAlert(report: NewAdsReport, env: Record<string, string | undefined> = process.env, fetchImpl: FetchLike = fetch): Promise<"posted" | "printed" | "nothing"> {
  const text = alertText(report);
  if (!text) return "nothing";
  const webhook = env.ADWARP_LIBRARY_ALERT_WEBHOOK?.trim();
  if (!webhook) return "printed";
  await postAlert(webhook, text, fetchImpl);
  return "posted";
}

/**
 * Posts {"text": ...} to a webhook (a Slack incoming webhook works). The URL is a secret, so no error message
 * includes it: failures say only the status.
 */
export async function postAlert(webhookUrl: string, text: string, fetchImpl: FetchLike = fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new Error("The alert webhook could not be reached.");
  }
  if (!res.ok) throw new Error(`The alert webhook answered ${res.status}.`);
}

