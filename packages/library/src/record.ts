// Vendored from adwarp-dev/website lib/ads/record.ts, the record format the adwarp.dev ad library reads. Keep the
// 2 files identical apart from this header: change the website copy first, then copy it here, so both sides check
// records with the same rules (test/record.test.mjs checks that the drafts this package writes pass parseAdRecord).

/*
  The ad library's record format: 1 JSON file per ad in content/ads/<slug>.json, written by the collector
  (`adwarp library drafts` in github.com/adwarp-dev/adwarp) and edited by hand in a pull request.

  Ownership, so a new collection run never overwrites an editor's work:
  - The collector owns `source`, `advertiser.platformId`, `evidence`, and fills `copy` only while it is null.
  - The editor owns `status`, `selection`, `writeup`, `creative`, `review`, `offerType` and `offerDetail`. The collector
    writes the first 5 once, when it creates the file, and never again, and never writes the offer fields at all.

  Lifecycle: media_pending (evidence saved, creative not inspected yet) -> draft (write-up ready for review) ->
  published. unpublished keeps the file and its history but takes the page down; rejected never shows anywhere.
  Production renders published records only. Preview deployments and `next dev` also render media_pending and draft
  records, under a Draft banner and with noindex, so a pull request's preview shows the exact page before it ships.

  Every claim a page makes comes from `evidence`. parseAdRecord() enforces the rules below and the build fails on a
  record that breaks them, so a missing metric can never turn into a badge.

  This file has no Next.js or React imports on purpose: scripts/check-ads.ts and the collector's tests read it too.
*/

export const AD_PLATFORMS = ["linkedin", "google", "meta", "tiktok"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/*
  Where the record came from. A platform can have 2 sources that must never be mixed: TikTok's Commercial Content API
  is a transparency library (coverage), Top Ads is TikTok's own ranked selection (popularity).
*/
export const AD_SOURCE_TYPES = [
  "linkedin-ad-library",
  "google-ads-transparency",
  "meta-ad-library",
  "tiktok-commercial-content",
  "tiktok-top-ads",
] as const;
export type AdSourceType = (typeof AD_SOURCE_TYPES)[number];

const SOURCE_PLATFORM: Record<AdSourceType, AdPlatform> = {
  "linkedin-ad-library": "linkedin",
  "google-ads-transparency": "google",
  "meta-ad-library": "meta",
  "tiktok-commercial-content": "tiktok",
  "tiktok-top-ads": "tiktok",
};

/* official-api: the platform's own API. provider: a paid third party (name it). manual: copied by hand from the
   platform's public page, such as a curated Top Ads list. */
export const AD_ROUTES = ["official-api", "provider", "manual"] as const;
export type AdRoute = (typeof AD_ROUTES)[number];

export const AD_STATUSES = ["media_pending", "draft", "published", "unpublished", "rejected"] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

export const AD_FORMATS = [
  "single-image",
  "video",
  "carousel",
  "document",
  "thought-leader",
  "event",
  "message",
  "text",
  "spotlight",
  "search",
  "display",
  "other",
] as const;
export type AdFormat = (typeof AD_FORMATS)[number];

/*
  The collections a record can be featured in. Each needs its own evidence (see collectionProblem):
  - most-seen: a source-reported exposure metric (impressions, reach, times shown, unique users seen) with a lower
    bound and a geography. Ranked only against records with the same platform, metric and geography.
  - long-running: first and last shown dates at least LONG_RUN_DAYS apart, or that many days of weekly observations
    that all saw it live.
  - top-ads: a TikTok Top Ads entry with the filters it was ranked under.
  - editors-pick: chosen for the creative alone. The page says it isn't ranked by a metric.
  Trending and "Popular on Adwarp" are left out until there are snapshots and traffic to support them.
*/
export const AD_COLLECTIONS = ["most-seen", "long-running", "top-ads", "editors-pick"] as const;
export type AdCollection = (typeof AD_COLLECTIONS)[number];

export const LONG_RUN_DAYS = 30;

/*
  What the ad offers in exchange for the click, read off the ad itself, so it needs `copy` or
  review.inspectedCreativeAt. Editor-owned and optional: a record without it just isn't on an offer page.
  - lead-magnet: a report, guide, template, ebook or tool given for contact details
  - gift: a gift card, AirPods or another item for booking or taking a meeting
  - free-trial, demo, discount
  - event: a webinar or an event
  - other: an offer none of these fit
  `offerDetail` names it in a few words, such as "AirPods Pro" or "$100 Amazon gift card".
*/
export const AD_OFFER_TYPES = ["lead-magnet", "gift", "free-trial", "demo", "event", "discount", "other"] as const;
export type AdOfferType = (typeof AD_OFFER_TYPES)[number];

/* Exposure metrics can rank a most-seen collection. The rest (likes, CTR, view rate) only ever describe. */
export const EXPOSURE_METRICS = ["impressions", "reach", "times-shown", "unique-users-seen"] as const;
export const AD_METRIC_NAMES = [...EXPOSURE_METRICS, "ctr", "view-rate", "likes", "comments", "shares"] as const;
export type AdMetricName = (typeof AD_METRIC_NAMES)[number];

/*
  1 number exactly as the source reported it.
  - exact: a count, `value`. estimate: a rounded or modelled single number such as TikTok's "11K" or Meta's EU
    reach, read into `value`. range: `lower` and, unless the band is open-ended like "1M+", `upper`.
  - relative and rank: words or an ordering only, such as "Top 10%" or "3". They never get a number in value,
    lower or upper, so a relative CTR label can't become an invented percentage.
  `text` keeps the source's own wording ("100k-200k"). A metric the source didn't report is left out, never 0.
*/
export type AdMetric = {
  name: AdMetricName;
  kind: "exact" | "estimate" | "range" | "relative" | "rank";
  value?: number;
  lower?: number;
  upper?: number;
  text: string;
  geography: string; // the scope the source measured, never widened: "total" (every country the ad ran in, such as
  // LinkedIn's impression band, with the countries in evidence.regions), "EU" only for an EU-only number, or a country
  // code such as "US" or "DE"
  period: string; // "lifetime", "last 30 days", or "2026-10-01/2026-10-31"
  source: string; // "LinkedIn Ad Library API"
  collectedAt: string; // YYYY-MM-DD
};

/* The copy the source returned or an editor read off the creative, word for word. Never written from a thumbnail
   alone, and never changed to fit the site's copy rules: the dash and emoji ban skips it. */
export type AdCopy = {
  intro?: string;
  headline?: string;
  body?: string;
  cta?: string;
  displayUrl?: string;
  cards?: { headline?: string; body?: string }[];
};

/*
  How the page shows the creative:
  - drawn: Adwarp's own halftone drawing of the format (components/blog/ad-mocks.tsx) beside the quoted copy. Hosts
    nothing from the advertiser, so it is the default. Needs `copy`.
  - image: a file in public/ads/, only with a `basis` that says why we may host it (the advertiser's permission, for
    example). Needs `alt`.
  - embed: the platform's own embed player (YouTube or TikTok), with a `basis`.
  - source-link: no preview, only the link to the ad on the platform.
  Every display mode keeps the source link.
*/
export const AD_DISPLAYS = ["drawn", "image", "embed", "source-link"] as const;
export type AdDisplay = (typeof AD_DISPLAYS)[number];
export const AD_RATIOS = ["1:1", "1.91:1", "4:5", "9:16", "16:9"] as const;
export type AdRatio = (typeof AD_RATIOS)[number];
export const EMBED_HOSTS = ["www.youtube-nocookie.com", "www.youtube.com", "www.tiktok.com"];

export type AdCreative = {
  display: AdDisplay;
  ratio?: AdRatio;
  src?: string;
  alt?: string;
  basis?: string;
};

export type AdEvidence = {
  checkedAt: string; // when the collector last read the source, YYYY-MM-DD
  firstShown?: string | null;
  lastShown?: string | null;
  live?: boolean | null; // still serving when checked; null when the source doesn't say
  regions?: string[]; // where the source says it ran
  metrics: AdMetric[];
  observations?: { at: string; live: boolean }[]; // repeated checks, oldest first
  topAds?: { region: string; industry: string; objective: string; period: string; sortedBy: string; rank: number };
  family?: string; // creative family fingerprint: near-identical ads share it, each keeps its own metrics
  notes?: string[]; // coverage notes, such as "Copy not returned by the API"
};

export type AdWriteup = {
  title: string; // the H1, 1 sentence, no period
  summary: string; // the lead: what the ad does, in 1 or 2 sentences
  hook: string | null;
  problem: string | null;
  offer: string | null;
  proof: string | null;
  cta: string | null;
  testIdea: string; // 1 idea another advertiser could test, shown labelled as analysis
  missing: string[]; // what we don't know, such as "Spend, clicks and leads"
};

export type AdRecord = {
  version: 1;
  slug: string;
  status: AdStatus;
  statusNote?: string; // why it is media_pending, unpublished or rejected
  platform: AdPlatform;
  source: { type: AdSourceType; adId: string; url: string; route: AdRoute; provider?: string };
  advertiser: { name: string; platformId?: string; domain?: string };
  category: string; // "B2B SaaS" at launch
  format: AdFormat;
  offerType?: AdOfferType;
  offerDetail?: string;
  copy: AdCopy | null;
  creative: AdCreative;
  evidence: AdEvidence;
  selection: { collection: AdCollection; reason: string };
  writeup: AdWriteup | null;
  review?: { inspectedCreativeAt?: string; publishedAt?: string; unpublishedAt?: string; notes?: string };
};

/* ------------------------------------------------------------------------------------------------ */
/* Validation                                                                                        */

export class AdRecordError extends Error {
  constructor(
    readonly slug: string,
    readonly problems: string[],
  ) {
    super(`content/ads/${slug}.json:\n  - ${problems.join("\n  - ")}`);
    this.name = "AdRecordError";
  }
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Em and en dashes, and emoji: the site's copy rules (DESIGN.md) apply to records too.
const BANNED_CHARACTERS = /[\u2013\u2014]|\p{Extended_Pictographic}/u;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isDate = (value: unknown): value is string =>
  typeof value === "string" && DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/* Days the evidence shows the ad running: the dated span, or the span of consecutive live observations. */
export function runDays(evidence: AdEvidence): number | null {
  if (evidence.firstShown && evidence.lastShown) return daysBetween(evidence.firstShown, evidence.lastShown) + 1;
  const seen = evidence.observations ?? [];
  const first = seen[0];
  const last = seen[seen.length - 1];
  if (seen.length >= 2 && first && last && seen.every((o) => o.live)) return daysBetween(first.at, last.at) + 1;
  return null;
}

/* The number a metric ranks on: the value of an exact count or estimate, the lower bound of a range. */
export function metricFloor(metric: AdMetric): number | undefined {
  return metric.kind === "range" ? metric.lower : metric.kind === "exact" || metric.kind === "estimate" ? metric.value : undefined;
}

/* The exposure metric a most-seen ranking can use, or undefined. */
export function exposureMetric(evidence: AdEvidence): AdMetric | undefined {
  return evidence.metrics.find(
    (m) =>
      (EXPOSURE_METRICS as readonly string[]).includes(m.name) &&
      typeof metricFloor(m) === "number" &&
      m.geography.length > 0,
  );
}

/* Why the evidence can't support the collection, or null when it can. */
export function collectionProblem(record: AdRecord): string | null {
  const { collection } = record.selection;
  const { evidence } = record;
  switch (collection) {
    case "most-seen":
      return exposureMetric(evidence)
        ? null
        : "most-seen needs an exposure metric (impressions, reach, times-shown or unique-users-seen) with a number and a geography";
    case "long-running": {
      const days = runDays(evidence);
      return days !== null && days >= LONG_RUN_DAYS
        ? null
        : `long-running needs first and last shown dates, or live observations, at least ${LONG_RUN_DAYS} days apart (has ${days ?? "none"})`;
    }
    case "top-ads":
      return record.source.type === "tiktok-top-ads" && evidence.topAds
        ? null
        : "top-ads needs source.type tiktok-top-ads and evidence.topAds with the filters it was ranked under";
    case "editors-pick":
      return null;
  }
}

function metricProblems(metric: unknown, index: number): string[] {
  const at = `evidence.metrics[${index}]`;
  if (!isObject(metric)) return [`${at} must be an object`];
  const problems: string[] = [];
  if (!oneOf(AD_METRIC_NAMES, metric.name)) problems.push(`${at}.name must be one of ${AD_METRIC_NAMES.join(", ")}`);
  if (!oneOf(["exact", "estimate", "range", "relative", "rank"] as const, metric.kind))
    problems.push(`${at}.kind must be exact, estimate, range, relative or rank`);
  for (const key of ["text", "geography", "period", "source"] as const)
    if (typeof metric[key] !== "string" || !(metric[key] as string).trim()) problems.push(`${at}.${key} is required`);
  if (!isDate(metric.collectedAt)) problems.push(`${at}.collectedAt must be YYYY-MM-DD`);
  const numbers = (["value", "lower", "upper"] as const).filter((key) => metric[key] !== undefined);
  for (const key of numbers)
    if (typeof metric[key] !== "number" || !Number.isFinite(metric[key]) || (metric[key] as number) < 0)
      problems.push(`${at}.${key} must be a number of 0 or more`);
  if ((metric.kind === "exact" || metric.kind === "estimate") && typeof metric.value !== "number")
    problems.push(`${at}: an ${metric.kind} metric needs value`);
  if (metric.kind === "range" && typeof metric.lower !== "number") problems.push(`${at}: a range needs lower`);
  if (
    metric.kind === "range" &&
    typeof metric.lower === "number" &&
    typeof metric.upper === "number" &&
    metric.upper < metric.lower
  )
    problems.push(`${at}: upper is below lower`);
  if ((metric.kind === "relative" || metric.kind === "rank") && numbers.length > 0)
    problems.push(`${at}: a ${metric.kind} metric keeps its words in text and has no value, lower or upper`);
  return problems;
}

function stringsIn(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, i) => stringsIn(item, `${path}[${i}]`, out));
  else if (isObject(value)) for (const [key, item] of Object.entries(value)) stringsIn(item, path ? `${path}.${key}` : key, out);
  return out;
}

/*
  Checks 1 parsed JSON file and returns it typed, or throws an AdRecordError listing every problem. `fileSlug` is
  the file name without .json, which must match the record's slug.
*/
export function parseAdRecord(raw: unknown, fileSlug: string): AdRecord {
  const problems: string[] = [];
  if (!isObject(raw)) throw new AdRecordError(fileSlug, ["the file must hold 1 JSON object"]);
  const r = raw as Record<string, unknown>;

  if (r.version !== 1) problems.push("version must be 1");
  if (r.slug !== fileSlug) problems.push(`slug must match the file name (${fileSlug})`);
  if (typeof r.slug !== "string" || !SLUG.test(r.slug)) problems.push("slug must be lowercase words joined by hyphens");
  if (!oneOf(AD_STATUSES, r.status)) problems.push(`status must be one of ${AD_STATUSES.join(", ")}`);
  if (!oneOf(AD_PLATFORMS, r.platform)) problems.push(`platform must be one of ${AD_PLATFORMS.join(", ")}`);
  if (!oneOf(AD_FORMATS, r.format)) problems.push(`format must be one of ${AD_FORMATS.join(", ")}`);
  if (typeof r.category !== "string" || !r.category.trim()) problems.push("category is required");

  const source = r.source;
  if (!isObject(source)) problems.push("source is required");
  else {
    if (!oneOf(AD_SOURCE_TYPES, source.type)) problems.push(`source.type must be one of ${AD_SOURCE_TYPES.join(", ")}`);
    else if (SOURCE_PLATFORM[source.type] !== r.platform)
      problems.push(`source.type ${source.type} belongs to ${SOURCE_PLATFORM[source.type]}, not ${String(r.platform)}`);
    if (typeof source.adId !== "string" || !source.adId) problems.push("source.adId is required");
    if (typeof source.url !== "string" || !source.url.startsWith("https://")) problems.push("source.url must be an https URL");
    if (!oneOf(AD_ROUTES, source.route)) problems.push(`source.route must be one of ${AD_ROUTES.join(", ")}`);
    if (source.route === "provider" && (typeof source.provider !== "string" || !source.provider))
      problems.push("source.provider must name the provider when route is provider");
  }

  const advertiser = r.advertiser;
  if (!isObject(advertiser) || typeof advertiser.name !== "string" || !advertiser.name.trim())
    problems.push("advertiser.name is required");

  const copy = r.copy;
  if (copy !== null && !isObject(copy)) problems.push("copy must be an object or null");
  const hasCopy =
    isObject(copy) && ["intro", "headline", "body"].some((key) => typeof copy[key] === "string" && copy[key]);

  if (r.offerType !== undefined) {
    if (!oneOf(AD_OFFER_TYPES, r.offerType)) problems.push(`offerType must be one of ${AD_OFFER_TYPES.join(", ")}`);
    const review = r.review;
    if (!hasCopy && !(isObject(review) && isDate(review.inspectedCreativeAt)))
      problems.push("offerType needs copy or review.inspectedCreativeAt: an offer can only be read off the ad");
  }
  if (r.offerDetail !== undefined) {
    if (typeof r.offerDetail !== "string" || !r.offerDetail.trim()) problems.push("offerDetail must be text");
    if (r.offerType === undefined) problems.push("offerDetail needs offerType");
  }

  const creative = r.creative;
  if (!isObject(creative) || !oneOf(AD_DISPLAYS, creative.display))
    problems.push(`creative.display must be one of ${AD_DISPLAYS.join(", ")}`);
  else {
    if (creative.ratio !== undefined && !oneOf(AD_RATIOS, creative.ratio))
      problems.push(`creative.ratio must be one of ${AD_RATIOS.join(", ")}`);
    if (creative.display === "drawn" && !hasCopy)
      problems.push("creative.display drawn needs copy (intro, headline or body); use source-link until the copy is in");
    if (creative.display === "image") {
      if (typeof creative.src !== "string" || !creative.src.startsWith("/ads/"))
        problems.push("creative.src must be a file under public/ads/ for an image");
      if (typeof creative.alt !== "string" || !creative.alt.trim()) problems.push("creative.alt is required for an image");
    }
    if (creative.display === "embed") {
      let host = "";
      try {
        host = new URL(String(creative.src)).host;
      } catch {}
      if (!EMBED_HOSTS.includes(host)) problems.push(`creative.src must be an embed URL on ${EMBED_HOSTS.join(", ")}`);
    }
    if ((creative.display === "image" || creative.display === "embed") && !(typeof creative.basis === "string" && creative.basis.trim()))
      problems.push(`creative.basis must say why Adwarp may show this ${creative.display}`);
  }

  const evidence = r.evidence;
  if (!isObject(evidence)) problems.push("evidence is required");
  else {
    if (!isDate(evidence.checkedAt)) problems.push("evidence.checkedAt must be YYYY-MM-DD");
    for (const key of ["firstShown", "lastShown"] as const)
      if (evidence[key] !== undefined && evidence[key] !== null && !isDate(evidence[key]))
        problems.push(`evidence.${key} must be YYYY-MM-DD or null`);
    if (isDate(evidence.firstShown) && isDate(evidence.lastShown) && evidence.lastShown < evidence.firstShown)
      problems.push("evidence.lastShown is before firstShown");
    if (!Array.isArray(evidence.metrics)) problems.push("evidence.metrics must be a list (empty when the source reports none)");
    else evidence.metrics.forEach((metric, i) => problems.push(...metricProblems(metric, i)));
    if (evidence.observations !== undefined) {
      if (!Array.isArray(evidence.observations)) problems.push("evidence.observations must be a list");
      else {
        const dates = evidence.observations.map((o) => (isObject(o) ? o.at : undefined));
        if (!dates.every(isDate)) problems.push("evidence.observations[].at must be YYYY-MM-DD");
        else if (dates.some((d, i) => i > 0 && (d as string) < (dates[i - 1] as string)))
          problems.push("evidence.observations must be oldest first");
      }
    }
  }

  const selection = r.selection;
  if (!isObject(selection) || !oneOf(AD_COLLECTIONS, selection.collection))
    problems.push(`selection.collection must be one of ${AD_COLLECTIONS.join(", ")}`);
  if (!isObject(selection) || typeof selection.reason !== "string" || !selection.reason.trim())
    problems.push("selection.reason is required");

  const writeup = r.writeup;
  if (writeup !== null && writeup !== undefined) {
    if (!isObject(writeup)) problems.push("writeup must be an object or null");
    else {
      for (const key of ["title", "summary", "testIdea"] as const)
        if (typeof writeup[key] !== "string" || !(writeup[key] as string).trim()) problems.push(`writeup.${key} is required`);
      for (const key of ["hook", "problem", "offer", "proof", "cta"] as const)
        if (writeup[key] !== null && typeof writeup[key] !== "string") problems.push(`writeup.${key} must be text or null`);
      if (!Array.isArray(writeup.missing) || !writeup.missing.every((m) => typeof m === "string"))
        problems.push("writeup.missing must be a list of text");
      if (typeof writeup.title === "string" && /[.!]$/.test(writeup.title.trim()))
        problems.push("writeup.title must not end with a period");
    }
  } else if (writeup === undefined) problems.push("writeup must be present (null until it is written)");

  // Quoted ad copy stays word for word, so it is the 1 place the site's dash and emoji rule doesn't reach.
  for (const [path, text] of stringsIn({ ...r, copy: null }, ""))
    if (BANNED_CHARACTERS.test(text)) problems.push(`${path} has an em dash, an en dash or an emoji`);

  if (problems.length) throw new AdRecordError(fileSlug, problems);

  const record = raw as unknown as AdRecord;
  const evidenceProblem = collectionProblem(record);
  if (evidenceProblem) problems.push(evidenceProblem);

  // The extra bar for going live.
  if (record.status === "published") {
    if (!record.writeup) problems.push("a published record needs a writeup");
    if (!record.review?.inspectedCreativeAt || !isDate(record.review.inspectedCreativeAt))
      problems.push("a published record needs review.inspectedCreativeAt: the date someone looked at the creative itself");
    if (!record.review?.publishedAt || !isDate(record.review.publishedAt))
      problems.push("a published record needs review.publishedAt (YYYY-MM-DD)");
  }
  if (record.status === "draft" && !record.writeup) problems.push("a draft needs a writeup; without one it is media_pending");
  if ((record.status === "media_pending" || record.status === "rejected" || record.status === "unpublished") && !record.statusNote)
    problems.push(`a ${record.status} record needs a statusNote saying why`);

  if (problems.length) throw new AdRecordError(fileSlug, problems);
  return record;
}
