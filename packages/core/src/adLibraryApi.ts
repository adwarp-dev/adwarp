/**
 * Official LinkedIn Ad Library API client.
 *
 * Calls the vetted partner endpoint `GET /rest/adLibrary?q=criteria`
 * (finder `partnerApiAdTransparencyCreativeEntities.FINDER-criteria`). Verified
 * against live responses. The API returns rich, structured METADATA per ad:
 *
 *   {
 *     adUrl, isRestricted,
 *     details: {
 *       type,                                  // ad format, e.g. SPONSORED_STATUS_UPDATE
 *       advertiser: { advertiserName, adPayer, advertiserUrl },
 *       adStatistics: {                        // EU-served ads only
 *         firstImpressionAt, latestImpressionAt,   // epoch ms
 *         totalImpressions: { from, to },
 *         impressionsDistributionByCountry: [{ country: "urn:li:country:RO", impressionPercentage }]
 *       },
 *       adTargeting: [{ facetName, includedSegments, excludedSegments, isIncluded, isExcluded }]
 *     }
 *   }
 *
 * It does NOT return the ad creative copy/image — only the detail-page URL. Copy
 * is layered in separately by the scraper (see competitorAds.ts).
 *
 * Confirmed `criteria` params: `keyword`, `advertiser` (name), `countries`
 * (restli List of country URNs). There is no company-id param. `dateRange` is
 * NOT documented (Microsoft Learn has no Ad Library API page); third-party
 * clients send it in the reporting shape, so it is opt-in and unverified here:
 * see AdLibraryApiOptions.dateRange.
 *
 * ACCESS: vetted product. The app must be granted "LinkedIn Ad Library" in the
 * Developer Portal; until then the endpoint returns 403 ACCESS_DENIED.
 */

import type { LinkedInClient } from "./http.js";
import { type DateRange, encDateRange } from "./resources/analytics.js";
import type { AdLibraryAd, AdLibraryDetail } from "./adLibrary.js";

export interface AdLibraryApiOptions {
  keyword?: string;
  /** Advertiser display name (the only advertiser filter the API supports). */
  advertiser?: string;
  /** ISO-3166 country codes, e.g. ["US", "GB"] — converted to country URNs. */
  countries?: string[];
  /**
   * UNVERIFIED: an undocumented `dateRange` in the reporting shape
   * `(start:(year,month,day),end:(year,month,day))`, sent only when set (through
   * rawQuery, so the structure stays literal). LinkedIn may reject or ignore it;
   * callers must check the results fall inside the range before trusting it.
   */
  dateRange?: DateRange;
  /** Max ads to collect across pages (default 50). */
  max?: number;
  /** Delay between pages to respect the per-minute rate limit (default 2200ms). */
  pageDelayMs?: number;
  onProgress?: (m: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isThrottle = (e: unknown): boolean => {
  const err = e as { status?: number; message?: string };
  return err?.status === 429 || /throttl/i.test(err?.message ?? "");
};

/** An ad enriched with the raw API element it was normalized from. */
export type AdLibraryApiAd = AdLibraryAd & { raw?: unknown };

export interface AdLibraryApiResult {
  fetched: number;
  /** The advertiser-wide total the API reports for this query. */
  totalReported?: number;
  ads: AdLibraryApiAd[];
}

/** Raised when the app isn't provisioned for the Ad Library product. */
export class AdLibraryAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdLibraryAccessError";
  }
}

/** Restli list literal of country URNs, e.g. List(urn:li:country:us,urn:li:country:gb). */
const countryList = (codes: string[]) =>
  `List(${codes.map((c) => `urn:li:country:${c.toLowerCase()}`).join(",")})`;

const epochToDate = (ms: unknown): string | undefined => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString().slice(0, 10);
};

/**
 * The impression band exactly as the API sent it, as numbers. `to` is absent for
 * an open-ended top band such as "1M+". Undefined when the ad has no band (only
 * ads served in the EU carry one). The ad library ranks on these numbers; the
 * string from compactImpressions stays the display form everywhere else.
 */
export function impressionBounds(range: unknown): { from?: number; to?: number } | undefined {
  if (!range || typeof range !== "object") return undefined;
  const r = range as { from?: unknown; to?: unknown };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const from = num(r.from);
  const to = num(r.to);
  if (from === undefined && to === undefined) return undefined;
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

const compactImpressions = (range: unknown): string | undefined => {
  const r = impressionBounds(range);
  if (!r) return undefined;
  const fmt = (n?: number) => (typeof n === "number" ? (n >= 1000 ? `${n / 1000}k` : String(n)) : "?");
  return `${fmt(r.from)}-${fmt(r.to)}`;
};

/**
 * True when the ad's advertiser page is the given numeric LinkedIn company. A
 * name search also returns partners and similarly named companies, so callers
 * that know the company ID filter on this.
 */
export function isCompanyAd(ad: AdLibraryAd, companyId: string): boolean {
  return Boolean(ad.detail?.advertiserUrl?.replace(/\/$/, "").endsWith(`/company/${companyId}`));
}

const countryCode = (urn: unknown): string =>
  typeof urn === "string" ? urn.replace(/^urn:li:country:/, "").toUpperCase() : String(urn ?? "");

/** Normalize one live API element into our unified AdLibraryAd shape. */
export function normalizeApiElement(el: Record<string, unknown>): AdLibraryApiAd {
  const adUrl = typeof el.adUrl === "string" ? el.adUrl : "";
  const detailId = adUrl.match(/detail\/(\d+)/)?.[1] ?? "";
  const details = (el.details ?? {}) as Record<string, unknown>;
  const advertiser = (details.advertiser ?? {}) as Record<string, unknown>;
  const stats = details.adStatistics as Record<string, unknown> | undefined;
  const targetingArr = Array.isArray(details.adTargeting) ? (details.adTargeting as Record<string, unknown>[]) : [];

  const detail: AdLibraryDetail = {};
  if (typeof details.type === "string") detail.format = details.type;
  if (typeof advertiser.adPayer === "string") detail.paidForBy = advertiser.adPayer;
  if (typeof advertiser.advertiserUrl === "string") detail.advertiserUrl = advertiser.advertiserUrl;

  if (stats) {
    const from = epochToDate(stats.firstImpressionAt);
    const to = epochToDate(stats.latestImpressionAt);
    if (from) detail.ranFrom = from;
    if (to) detail.ranTo = to;
    const impr = compactImpressions(stats.totalImpressions);
    if (impr) detail.totalImpressions = impr;
    const dist = stats.impressionsDistributionByCountry;
    if (Array.isArray(dist)) {
      detail.impressionsByCountry = dist
        .map((c) => {
          const o = c as Record<string, unknown>;
          const pct = o.impressionPercentage;
          return {
            country: countryCode(o.country),
            share: typeof pct === "number" ? `${pct.toFixed(1)}%` : String(pct ?? ""),
          };
        })
        .filter((c) => c.country);
    }
  }

  const targeting = targetingArr
    .map((t) => ({
      facet: typeof t.facetName === "string" ? t.facetName : "",
      included: Array.isArray(t.includedSegments) ? (t.includedSegments as string[]) : [],
      excluded: Array.isArray(t.excludedSegments) ? (t.excludedSegments as string[]) : [],
    }))
    // Keep only facets that actually carry segments (the API lists empty ones too).
    .filter((t) => t.facet && (t.included.length || t.excluded.length));
  if (targeting.length) detail.targeting = targeting;

  return {
    detailId,
    detailUrl: adUrl || (detailId ? `https://www.linkedin.com/ad-library/detail/${detailId}` : ""),
    advertiser: typeof advertiser.advertiserName === "string" ? advertiser.advertiserName : "",
    promotedBy: typeof advertiser.adPayer === "string" ? advertiser.adPayer : undefined,
    // The API has no copy/image; the scraper fills these in later (hybrid).
    commentary: undefined,
    format: typeof details.type === "string" ? details.type : undefined,
    detail: Object.keys(detail).length ? detail : undefined,
    raw: el,
  };
}

/**
 * The criteria query with a dateRange, as a raw restli string: values are
 * percent-encoded, the List(...) and dateRange structure stays literal.
 */
export function adLibraryRawQuery(query: Record<string, string | number | undefined>, dateRange: DateRange): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (k === "countries") {
      const urns = String(v).replace(/^List\(|\)$/g, "").split(",").filter(Boolean);
      parts.push(`countries=List(${urns.map((u) => encodeURIComponent(u)).join(",")})`);
    } else parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  parts.push(`dateRange=${encDateRange(dateRange)}`);
  return parts.join("&");
}

/**
 * Search the official Ad Library API, paging until `max` ads or exhaustion.
 * Throws AdLibraryAccessError on 403 so the caller can fall back to the scraper.
 */
export async function searchAdLibraryApi(
  client: LinkedInClient,
  opts: AdLibraryApiOptions,
): Promise<AdLibraryApiResult> {
  if (!opts.advertiser && !opts.keyword) {
    throw new Error(
      "The Ad Library API filters by advertiser name or keyword (it has no company-id parameter). " +
        "Provide `advertiser` or `keyword`.",
    );
  }
  const max = opts.max ?? 50;
  const pageDelayMs = opts.pageDelayMs ?? 2200;
  const progress = opts.onProgress ?? (() => {});
  const ads: AdLibraryApiAd[] = [];
  let start = 0;
  let totalReported: number | undefined;
  // The criteria finder caps `count` at 25 per page; paginate via `start`.
  const pageSize = Math.min(25, max);

  while (ads.length < max) {
    const query: Record<string, string | number | undefined> = { q: "criteria", count: pageSize, start };
    if (opts.keyword) query.keyword = opts.keyword;
    if (opts.advertiser) query.advertiser = opts.advertiser;
    if (opts.countries?.length) query.countries = countryList(opts.countries);

    let res;
    // The Ad Library API is rate-limited per minute. On a throttle, wait out the
    // window and retry the same page (a few times) rather than failing the pull.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await client.request<{
          elements?: Record<string, unknown>[];
          paging?: { total?: number };
        }>(opts.dateRange ? { path: "/adLibrary", rawQuery: adLibraryRawQuery(query, opts.dateRange) } : { path: "/adLibrary", query });
        break;
      } catch (e) {
        const err = e as { status?: number; message?: string };
        if (err.status === 403) {
          throw new AdLibraryAccessError(
            "The Ad Library API is not provisioned for this app. Request the 'LinkedIn Ad Library' product " +
              "in the Developer Portal (Products tab). " + (err.message ?? ""),
          );
        }
        if (isThrottle(e) && attempt < 5) {
          progress(`Rate limited; waiting 60s before retrying (have ${ads.length}/${max})...`);
          await sleep(60_000);
          continue;
        }
        throw e;
      }
    }

    if (totalReported === undefined && typeof res.data.paging?.total === "number") {
      totalReported = res.data.paging.total;
    }
    const elements = res.data.elements ?? [];
    if (!elements.length) break;
    for (const el of elements) {
      ads.push(normalizeApiElement(el));
      if (ads.length >= max) break;
    }
    if (elements.length < pageSize) break;
    start += pageSize;
    progress(`Fetched ${ads.length}/${Math.min(max, totalReported ?? max)} ads...`);
    if (pageDelayMs) await sleep(pageDelayMs);
  }

  return { fetched: ads.length, totalReported, ads };
}
