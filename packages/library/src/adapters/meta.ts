/**
 * Meta Ad Library adapter: GET graph.facebook.com/<version>/ads_archive.
 *
 * Field names follow Meta's Ad Library API reference as reproduced in Meta's own client library
 * (facebookresearch/Radlibrary, R/adlib.R). developers.facebook.com could not be read directly while this was
 * written, so check the field list against the live reference on the first real run.
 *
 * Coverage: commercial ads delivered in the EU (and the UK) in the past year, plus political and issue ads. It is
 * not a feed of US commercial ads. Meta returns no format and no media for commercial ads, so format starts as
 * "other" and an editor sets it after inspecting the ad.
 *
 * ad_snapshot_url carries the access token in its query string, so records never store it: the source link is
 * https://www.facebook.com/ads/library/?id=<id>.
 */
import { metaLibraryCredentials, type LibraryEnv } from "../credentials.js";
import { requestJson } from "../http.js";
import { addDays, toDay } from "../parse.js";
import type { AdCopy, AdMetric } from "../record.js";
import type { Candidate, FetchLike } from "../types.js";
import type { WatchlistEntry } from "../watchlist.js";

export const META_SOURCE = "Meta Ad Library API";

export const META_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creation_time",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "ad_creative_bodies",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_creative_link_captions",
  "publisher_platforms",
  "languages",
  "eu_total_reach",
  "age_country_gender_reach_breakdown",
] as const;

export interface MetaAd {
  id: string;
  page_id?: string;
  page_name?: string;
  ad_creation_time?: string;
  ad_delivery_start_time?: string;
  ad_delivery_stop_time?: string;
  ad_creative_bodies?: string[];
  ad_creative_link_titles?: string[];
  ad_creative_link_descriptions?: string[];
  ad_creative_link_captions?: string[];
  publisher_platforms?: string[];
  languages?: string[];
  eu_total_reach?: number;
  age_country_gender_reach_breakdown?: { country?: string }[];
}

interface MetaPage {
  data?: MetaAd[];
  paging?: { cursors?: { after?: string }; next?: string };
}

export const metaAdUrl = (id: string) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(id)}`;

const first = (list: string[] | undefined) => list?.find((s) => typeof s === "string" && s.trim())?.trim();

/** The first version of the ad's copy, word for word. */
export function metaCopy(ad: MetaAd): AdCopy | null {
  const copy: AdCopy = {};
  const intro = first(ad.ad_creative_bodies);
  const headline = first(ad.ad_creative_link_titles);
  const body = first(ad.ad_creative_link_descriptions);
  const displayUrl = first(ad.ad_creative_link_captions);
  if (intro) copy.intro = intro;
  if (headline) copy.headline = headline;
  if (body) copy.body = body;
  if (displayUrl) copy.displayUrl = displayUrl;
  return Object.keys(copy).length ? copy : null;
}

/** eu_total_reach is Meta's estimated reach in the EU: an estimate with the EU as its geography. */
export function metaReach(ad: MetaAd, collectedAt: string): AdMetric | undefined {
  if (typeof ad.eu_total_reach !== "number" || !Number.isFinite(ad.eu_total_reach)) return undefined;
  return {
    name: "reach",
    kind: "estimate",
    value: ad.eu_total_reach,
    text: String(ad.eu_total_reach),
    geography: "EU",
    period: "lifetime",
    source: `${META_SOURCE} (eu_total_reach)`,
    collectedAt,
  };
}

/**
 * Turns 1 ads_archive row into a candidate. `active` says which status filter returned it: Meta's ACTIVE filter
 * means the ad was delivering when checked, so its last shown day is the check day.
 */
export function metaCandidate(ad: MetaAd, ctx: { entry: WatchlistEntry; category: string; checkedAt: string; active: boolean; countries: string[] }): Candidate {
  const copy = metaCopy(ad);
  const stop = toDay(ad.ad_delivery_stop_time);
  const lastShown = ctx.active ? ctx.checkedAt : stop;
  const reach = metaReach(ad, ctx.checkedAt);
  const breakdownCountries = (ad.age_country_gender_reach_breakdown ?? [])
    .map((row) => row.country)
    .filter((c): c is string => typeof c === "string" && c.length > 0);
  const notes = ["Meta's API doesn't return the format or the media. Set the format after inspecting the ad on its Ad Library page."];
  const versions = Math.max(ad.ad_creative_bodies?.length ?? 0, ad.ad_creative_link_titles?.length ?? 0);
  if (versions > 1) notes.push(`${versions} versions of the copy; the first is quoted.`);
  if (ctx.active) notes.push(`Returned by the ACTIVE filter on ${ctx.checkedAt}, so it was still delivering that day.`);
  if (!reach) notes.push("No eu_total_reach: Meta reports reach only for ads delivered in the EU.");
  if (ad.publisher_platforms?.length) notes.push(`Placements: ${ad.publisher_platforms.join(", ")}.`);
  return {
    platform: "meta",
    source: { type: "meta-ad-library", adId: ad.id, url: metaAdUrl(ad.id), route: "official-api" },
    advertiser: { name: ctx.entry.name, ...(ad.page_id ? { platformId: ad.page_id } : {}), ...(ctx.entry.domain ? { domain: ctx.entry.domain } : {}) },
    ...(ad.page_name ? { sourceAdvertiserName: ad.page_name } : {}),
    category: ctx.entry.category ?? ctx.category,
    format: "other",
    copy,
    creativeRefs: [],
    firstShown: toDay(ad.ad_delivery_start_time),
    lastShown,
    live: ctx.active,
    regions: [...new Set(breakdownCountries.length ? breakdownCountries : ctx.countries)],
    metrics: reach ? [reach] : [],
    notes,
    checkedAt: ctx.checkedAt,
  };
}

export interface MetaCollectOptions {
  entry: WatchlistEntry;
  category: string;
  checkedAt: string;
  max: number;
  /** Countries the ads reached. Required by Meta; commercial ads need EU or UK countries. */
  countries: string[];
  accessToken: string;
  version: string;
  fetch?: FetchLike;
  delayScale?: number;
}

/**
 * Pulls 1 advertiser's ads by Page ID, once with the ACTIVE filter and once with INACTIVE, so each ad's status comes
 * from Meta rather than from a guess. Pages through `after` cursors (never the `next` URL, which repeats the token).
 */
export async function collectMeta(opts: MetaCollectOptions): Promise<{ candidates: Candidate[]; fetched: number }> {
  const pageIds = opts.entry.meta?.pageIds ?? [];
  if (!pageIds.length) throw new Error(`${opts.entry.name} has no meta.pageIds`);
  if (!opts.countries.length) throw new Error("Meta needs at least 1 country (ad_reached_countries), such as DE");
  const fetchImpl = opts.fetch ?? fetch;
  const seen = new Map<string, Candidate>();
  let fetched = 0;
  for (const status of ["ACTIVE", "INACTIVE"] as const) {
    let after: string | undefined;
    // Ads that stopped more than a year ago fall out of the commercial library anyway; the window keeps pages small.
    const since = addDays(opts.checkedAt, -365);
    while (seen.size < opts.max) {
      const params = new URLSearchParams({
        access_token: opts.accessToken,
        ad_type: "ALL",
        ad_active_status: status,
        ad_reached_countries: JSON.stringify(opts.countries),
        search_page_ids: JSON.stringify(pageIds.slice(0, 10)),
        ad_delivery_date_min: since,
        fields: META_FIELDS.join(","),
        limit: String(Math.min(100, opts.max)),
      });
      if (after) params.set("after", after);
      const url = `https://graph.facebook.com/${opts.version}/ads_archive?${params}`;
      const page = await requestJson<MetaPage>(fetchImpl, url, { method: "GET" }, {
        name: META_SOURCE,
        ...(opts.delayScale !== undefined ? { delayScale: opts.delayScale } : {}),
      });
      const rows = page.data ?? [];
      fetched += rows.length;
      for (const ad of rows) {
        if (!ad?.id || seen.has(ad.id)) continue;
        if (ad.page_id && !pageIds.includes(ad.page_id)) continue;
        seen.set(
          ad.id,
          metaCandidate(ad, { entry: opts.entry, category: opts.category, checkedAt: opts.checkedAt, active: status === "ACTIVE", countries: opts.countries }),
        );
        if (seen.size >= opts.max) break;
      }
      after = page.paging?.cursors?.after;
      if (!rows.length || !after || !page.paging?.next) break;
    }
    if (seen.size >= opts.max) break;
  }
  return { candidates: [...seen.values()], fetched };
}

export function metaCollectorFromEnv(env: LibraryEnv = process.env) {
  const creds = metaLibraryCredentials(env);
  return (opts: Omit<MetaCollectOptions, "accessToken" | "version">) => collectMeta({ ...opts, ...creds });
}

