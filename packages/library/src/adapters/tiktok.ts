/**
 * TikTok Commercial Content API adapter (the ad library TikTok runs for transparency, EU coverage).
 *
 * - Token: POST open.tiktokapis.com/v2/oauth/token/ with the research project's client key and secret
 *   (grant_type=client_credentials).
 * - Query Ads: POST open.tiktokapis.com/v2/research/adlib/ad/query/?fields=... with a search term, a country and a
 *   published date range. It has no advertiser filter, so results are kept only when the business ID matches the
 *   watchlist.
 *
 * Quirks from TikTok's documentation: ad and business IDs are 64-bit numbers (parsed as strings here), reach is
 * text such as "11K" or "0-1K", `status` is the ad's review status rather than whether it is serving, and the
 * documented examples spell 2 fields differently from the field list (`unique_user_seen`, `buisness_id`), so both
 * spellings are read.
 *
 * Top Ads (TikTok Creative Center) is a separate product with no public API. Those records are entered by hand with
 * source.type "tiktok-top-ads" and route "manual"; this adapter never produces them.
 */
import { tiktokLibraryCredentials, type LibraryEnv } from "../credentials.js";
import { requestJson } from "../http.js";
import { addDays, compactToDay, countMetric, stripQuery } from "../parse.js";
import type { AdFormat } from "../record.js";
import type { Candidate, FetchLike } from "../types.js";
import type { WatchlistEntry } from "../watchlist.js";

export const TIKTOK_SOURCE = "TikTok Commercial Content API";
const API = "https://open.tiktokapis.com/v2";

export const TIKTOK_FIELDS = [
  "ad.id",
  "ad.first_shown_date",
  "ad.last_shown_date",
  "ad.status",
  "ad.status_statement",
  "ad.videos",
  "ad.image_urls",
  "ad.reach",
  "advertiser.business_id",
  "advertiser.business_name",
  "advertiser.paid_for_by",
] as const;

export interface TikTokAdRow {
  ad?: {
    id?: string | number;
    first_shown_date?: string | number;
    last_shown_date?: string | number;
    status?: string;
    status_statement?: string;
    videos?: { url?: string; cover_image_url?: string }[];
    image_urls?: string[];
    reach?: { unique_users_seen?: string; unique_user_seen?: string; unique_users_seen_by_country?: Record<string, string> };
  };
  advertiser?: { business_id?: string | number; buisness_id?: string | number; business_name?: string; paid_for_by?: string };
}

interface QueryResponse {
  data?: { ads?: TikTokAdRow[]; has_more?: boolean; search_id?: string; cursor?: number | string };
  error?: { code?: string; message?: string; log_id?: string };
}

export const tiktokAdUrl = (id: string) => `https://library.tiktok.com/ads/detail/?ad_id=${encodeURIComponent(id)}`;

/** YYYY-MM-DD to TikTok's 20260101 form. */
const compact = (day: string) => day.replace(/-/g, "");

export function tiktokFormat(row: TikTokAdRow): AdFormat {
  if (row.ad?.videos?.length) return "video";
  if ((row.ad?.image_urls?.length ?? 0) > 1) return "carousel";
  if (row.ad?.image_urls?.length) return "single-image";
  return "other";
}

/** 1 Query Ads row to a candidate. `country` is the country the query filtered on, the scope of its reach number. */
export function tiktokCandidate(row: TikTokAdRow, ctx: { entry: WatchlistEntry; category: string; checkedAt: string; country: string }): Candidate | undefined {
  const id = row.ad?.id === undefined ? "" : String(row.ad.id);
  if (!id) return undefined;
  const businessId = row.advertiser?.business_id ?? row.advertiser?.buisness_id;
  const reachText = row.ad?.reach?.unique_users_seen ?? row.ad?.reach?.unique_user_seen;
  const reach = countMetric("unique-users-seen", reachText, {
    geography: ctx.country,
    period: "lifetime",
    source: TIKTOK_SOURCE,
    collectedAt: ctx.checkedAt,
  });
  const notes = ["Video and image URLs from TikTok are signed and expire; the source link is the lasting reference."];
  if (row.ad?.status) notes.push(`TikTok review status: ${row.ad.status}. This is not whether the ad is still serving.`);
  if (!reach) notes.push("No reach reported for this country.");
  const creativeRefs = [
    ...(row.ad?.videos ?? []).map((v) => v.url).filter((u): u is string => typeof u === "string"),
    ...(row.ad?.image_urls ?? []),
  ].map(stripQuery);
  return {
    platform: "tiktok",
    source: { type: "tiktok-commercial-content", adId: id, url: tiktokAdUrl(id), route: "official-api" },
    advertiser: {
      name: ctx.entry.name,
      ...(businessId !== undefined ? { platformId: String(businessId) } : {}),
      ...(ctx.entry.domain ? { domain: ctx.entry.domain } : {}),
    },
    ...(row.advertiser?.business_name ? { sourceAdvertiserName: row.advertiser.business_name } : {}),
    category: ctx.entry.category ?? ctx.category,
    format: tiktokFormat(row),
    copy: null,
    creativeRefs,
    firstShown: compactToDay(row.ad?.first_shown_date),
    lastShown: compactToDay(row.ad?.last_shown_date),
    live: null,
    regions: [ctx.country],
    metrics: reach ? [reach] : [],
    notes,
    checkedAt: ctx.checkedAt,
  };
}

/** A client-credentials access token for the research project. */
export async function tiktokAccessToken(clientKey: string, clientSecret: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await requestJson<{ access_token?: string; error?: string; error_description?: string }>(
    fetchImpl,
    `${API}/oauth/token/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "client_credentials" }).toString(),
    },
    { name: "TikTok OAuth" },
  );
  if (!res.access_token) throw new Error(`TikTok OAuth returned no access token: ${res.error_description ?? res.error ?? "unknown error"}`);
  return res.access_token;
}

export interface TikTokCollectOptions {
  entry: WatchlistEntry;
  category: string;
  checkedAt: string;
  max: number;
  /** 1 query per country; each ad's reach is scoped to the country it was found under. */
  countries: string[];
  accessToken: string;
  /** How far back first shown dates may go. Default 365 days. */
  days?: number;
  fetch?: FetchLike;
  delayScale?: number;
}

export async function collectTikTok(opts: TikTokCollectOptions): Promise<{ candidates: Candidate[]; fetched: number }> {
  const businessIds = new Set(opts.entry.tiktok?.businessIds ?? []);
  if (!businessIds.size) throw new Error(`${opts.entry.name} has no tiktok.businessIds`);
  if (!opts.countries.length) throw new Error("TikTok needs at least 1 country, such as DE");
  const fetchImpl = opts.fetch ?? fetch;
  const searchTerm = opts.entry.tiktok?.searchTerm ?? opts.entry.name;
  const max = addDays(opts.checkedAt, -1);
  const min = addDays(opts.checkedAt, -(opts.days ?? 365));
  const out = new Map<string, Candidate>();
  let fetched = 0;
  for (const country of opts.countries) {
    let searchId: string | undefined;
    let cursor: number | string | undefined;
    for (let page = 0; page < 20 && out.size < opts.max; page++) {
      const body: Record<string, unknown> = {
        filters: { ad_published_date_range: { min: compact(min), max: compact(max) }, country_code: country },
        search_term: searchTerm,
        max_count: 50,
      };
      if (searchId) body.search_id = searchId;
      if (cursor !== undefined) body.cursor = cursor;
      const res = await requestJson<QueryResponse>(
        fetchImpl,
        `${API}/research/adlib/ad/query/?fields=${TIKTOK_FIELDS.join(",")}`,
        { method: "POST", headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
        {
          name: TIKTOK_SOURCE,
          bigIdKeys: ["id", "business_id", "buisness_id"],
          ...(opts.delayScale !== undefined ? { delayScale: opts.delayScale } : {}),
        },
      );
      if (res.error?.code && res.error.code !== "ok")
        throw new Error(`${TIKTOK_SOURCE}: ${res.error.code} ${res.error.message ?? ""} (log ${res.error.log_id ?? "none"})`);
      const rows = res.data?.ads ?? [];
      fetched += rows.length;
      for (const row of rows) {
        const businessId = row.advertiser?.business_id ?? row.advertiser?.buisness_id;
        if (businessId === undefined || !businessIds.has(String(businessId))) continue;
        const candidate = tiktokCandidate(row, { entry: opts.entry, category: opts.category, checkedAt: opts.checkedAt, country });
        if (!candidate) continue;
        const known = out.get(candidate.source.adId);
        if (known) {
          // Found again under another country: keep 1 candidate with each country's reach as its own metric.
          known.metrics.push(...candidate.metrics.filter((m) => !known.metrics.some((k) => k.geography === m.geography)));
          if (!known.regions.includes(country)) known.regions.push(country);
          continue;
        }
        out.set(candidate.source.adId, candidate);
        if (out.size >= opts.max) break;
      }
      if (!res.data?.has_more || !rows.length) break;
      searchId = res.data.search_id ?? searchId;
      cursor = res.data.cursor;
    }
  }
  return { candidates: [...out.values()], fetched };
}

export async function tiktokCollectorFromEnv(env: LibraryEnv = process.env, fetchImpl: FetchLike = fetch) {
  const creds = tiktokLibraryCredentials(env);
  const accessToken = await tiktokAccessToken(creds.clientKey, creds.clientSecret, fetchImpl);
  return (opts: Omit<TikTokCollectOptions, "accessToken">) => collectTikTok({ ...opts, accessToken });
}
