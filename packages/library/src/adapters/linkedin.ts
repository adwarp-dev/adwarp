/**
 * LinkedIn Ad Library adapter. Reuses core's official API client (searchAdLibraryApi) with the library's own
 * credentials (credentials.ts), never the app Adwarp uses for ad accounts.
 *
 * What the API gives, per ad: the format code, the advertiser page, and for ads served in the EU the first and
 * latest impression dates, the total impression band and the share of impressions by country. It gives no copy
 * and no image, so every candidate starts with copy null and an editor reads the creative on its Ad Library page.
 */
import {
  type AdLibraryApiAd,
  type AdLibraryApiOptions,
  type AdLibraryApiResult,
  AdLibraryGuard,
  AdLibraryStopError,
  type AppConfig,
  DailyCallBudget,
  impressionBounds,
  isCompanyAd,
  LinkedInClient,
  searchAdLibraryApi,
} from "@adwarp/core";
import { createOauthTokenProvider, type CredentialStore, type StoredCredentials } from "@adwarp/shared";
import { linkedinLibraryCredentials, type LibraryEnv } from "../credentials.js";
import type { AdFormat, AdMetric } from "../record.js";
import type { Candidate } from "../types.js";
import type { WatchlistEntry } from "../watchlist.js";
import { type DayWindow, planMonths, servedFloor, walkLinkedIn, type WalkResult } from "./linkedinWindows.js";

export const LINKEDIN_SOURCE = "LinkedIn Ad Library API";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

/**
 * LinkedIn's `details.type` codes. Only the codes seen in live responses are listed exactly (SPONSORED_STATUS_UPDATE,
 * TEXT_AD, SPOTLIGHT_V2, SPONSORED_MESSAGE, SPONSORED_INMAILS); other codes are matched by the format word they
 * contain, and the raw code is kept in sourceFormat either way.
 */
export function linkedinFormat(type: string | undefined): AdFormat {
  if (!type) return "other";
  const known: Record<string, AdFormat> = {
    SPONSORED_STATUS_UPDATE: "single-image",
    TEXT_AD: "text",
    SPOTLIGHT_V2: "spotlight",
    SPONSORED_MESSAGE: "message",
    SPONSORED_INMAILS: "message",
  };
  if (known[type]) return known[type];
  if (/VIDEO/.test(type)) return "video";
  if (/CAROUSEL/.test(type)) return "carousel";
  if (/DOCUMENT/.test(type)) return "document";
  if (/EVENT/.test(type)) return "event";
  if (/SPOTLIGHT/.test(type)) return "spotlight";
  if (/INMAIL|MESSAGE|CONVERSATION/.test(type)) return "message";
  return "other";
}

const fmtCount = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : String(n));

/**
 * The total impression band as a metric. LinkedIn's band is the ad's total across every country it ran in, so the
 * geography is "total"; the countries go in evidence.regions. A band with only an upper bound starts at 0 because
 * that is the band LinkedIn reported ("under 1k"), not a missing number.
 */
export function linkedinImpressions(range: unknown, collectedAt: string): AdMetric | undefined {
  const bounds = impressionBounds(range);
  if (!bounds) return undefined;
  const lower = bounds.from ?? 0;
  const text =
    bounds.from === undefined
      ? `under ${fmtCount(bounds.to ?? 0)}`
      : bounds.to === undefined
        ? `${fmtCount(lower)}+`
        : `${fmtCount(lower)}-${fmtCount(bounds.to)}`;
  return {
    name: "impressions",
    kind: "range",
    lower,
    ...(bounds.to !== undefined ? { upper: bounds.to } : {}),
    text,
    geography: "total",
    period: "lifetime",
    source: LINKEDIN_SOURCE,
    collectedAt,
  };
}

/** Live only when LinkedIn reports an impression on or after the day before the check. Otherwise unknown. */
export function liveFromLastShown(lastShown: string | null, checkedAt: string): boolean | null {
  if (!lastShown) return null;
  const days = (Date.parse(`${checkedAt}T00:00:00Z`) - Date.parse(`${lastShown}T00:00:00Z`)) / 86_400_000;
  return days <= 1 ? true : null;
}

export type LinkedInSearch = (opts: AdLibraryApiOptions) => Promise<AdLibraryApiResult>;

/** The collector's daily Ad Library budget per app, unless --daily-calls or ADWARP_LIBRARY_LINKEDIN_DAILY_CALLS. */
export const DEFAULT_LIBRARY_DAILY_CALLS = 300;

/** The daily call budget from the option, then ADWARP_LIBRARY_LINKEDIN_DAILY_CALLS, then 300. */
export function libraryDailyCalls(env: LibraryEnv, dailyCalls?: number): number {
  if (dailyCalls !== undefined) return dailyCalls;
  const set = Number(env.ADWARP_LIBRARY_LINKEDIN_DAILY_CALLS);
  return Number.isInteger(set) && set > 0 ? set : DEFAULT_LIBRARY_DAILY_CALLS;
}

/**
 * A search bound to the library's own LinkedIn app, plus the run's guard: every call paced at least 2.2s apart and
 * counted against the app's daily budget (keyed on a hash of ADWARP_LIBRARY_LINKEDIN_CLIENT_ID; with an access token
 * alone, on "unknown-app"). Reads only ADWARP_LIBRARY_LINKEDIN_*.
 */
export async function createLinkedInLibrarySearch(
  env: LibraryEnv = process.env,
  opts: { dailyCalls?: number; stateDir?: string } = {},
): Promise<{ search: LinkedInSearch; guard: AdLibraryGuard }> {
  const creds = linkedinLibraryCredentials(env);
  const clientId = creds.kind === "refresh-token" ? creds.clientId : env.ADWARP_LIBRARY_LINKEDIN_CLIENT_ID?.trim() || undefined;
  const guard = new AdLibraryGuard({
    budget: new DailyCallBudget({
      limit: libraryDailyCalls(env, opts.dailyCalls),
      ...(clientId ? { clientId } : {}),
      ...(opts.stateDir ? { dir: opts.stateDir } : {}),
    }),
  });
  const config: AppConfig = {
    clientId: creds.kind === "refresh-token" ? creds.clientId : "",
    clientSecret: creds.kind === "refresh-token" ? creds.clientSecret : "",
    ...(creds.version ? { linkedinVersion: creds.version } : {}),
  };
  let getToken: () => Promise<string>;
  if (creds.kind === "access-token") {
    getToken = async () => creds.accessToken;
  } else {
    // In memory only: the library never writes LinkedIn tokens to disk.
    let stored: StoredCredentials | null = { accessToken: "", refreshToken: creds.refreshToken, expiresAt: 0 };
    const store: CredentialStore = {
      load: async () => stored,
      save: async (next) => {
        stored = next;
      },
    };
    getToken = await createOauthTokenProvider({
      provider: { tokenUrl: TOKEN_URL, clientId: creds.clientId, clientSecret: creds.clientSecret },
      store,
      reloginHint: "Refresh ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN from the library's own LinkedIn app.",
    });
  }
  const client = new LinkedInClient(config, getToken);
  return { search: (o) => searchAdLibraryApi(client, { ...o, guard }), guard };
}

export interface LinkedInCollectOptions {
  entry: WatchlistEntry;
  category: string;
  checkedAt: string;
  max: number;
  countries?: string[];
  search: LinkedInSearch;
  /**
   * Walk back 1 calendar month at a time (see linkedinWindows.ts) to reach ads that started long ago, and record the
   * months each ad was served in. `months` is 1 to 12, LinkedIn's lookback.
   */
  walkBack?: { months: number; windowCap?: number; windows?: DayWindow[] };
  /**
   * Incremental: the advertiser's ad IDs from the last run. Paging stops at the first full page with none of the
   * advertiser's ads missing from it, so a daily check costs about 1 or 2 calls.
   */
  known?: Set<string>;
  onProgress?: (message: string) => void;
}

export interface LinkedInCollectResult {
  candidates: Candidate[];
  fetched: number;
  note: string;
  /** The walk's months, unread windows and truncated days, for resuming. */
  walk?: Pick<WalkResult, "months" | "remaining" | "truncated" | "incomplete">;
  /** Throttled, access failed or the budget ran out: the run stops, and the candidates are what was read. */
  stopped?: AdLibraryStopError;
}

/**
 * Searches 1 advertiser by name and keeps only the ads whose advertiser page is its company ID. An entry without
 * a company ID is the caller's to skip: a name search alone returns lookalike advertisers.
 */
export async function collectLinkedIn(opts: LinkedInCollectOptions): Promise<LinkedInCollectResult> {
  const companyId = opts.entry.linkedin?.companyId;
  if (!companyId) throw new Error(`${opts.entry.name} has no linkedin.companyId`);
  const advertiser = opts.entry.linkedin?.searchName ?? opts.entry.name;
  let own: AdLibraryApiAd[];
  let fetched: number;
  let note: string;
  let walk: WalkResult | undefined;
  let stopped: AdLibraryStopError | undefined;
  if (opts.walkBack) {
    walk = await walkLinkedIn({
      search: opts.search,
      advertiser,
      companyId,
      windows: opts.walkBack.windows ?? planMonths(opts.checkedAt, opts.walkBack.months),
      checkedAt: opts.checkedAt,
      max: opts.max,
      ...(opts.walkBack.windowCap ? { windowCap: opts.walkBack.windowCap } : {}),
      ...(opts.countries?.length ? { countries: opts.countries } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
    });
    own = walk.ads;
    fetched = walk.fetched;
    stopped = walk.stopped;
    note = `Walked back in ${walk.queries} queries: ${own.length} ads for company ${companyId} from ${walk.fetched} results.`;
    if (walk.remaining.length) note += ` ${walk.remaining.length} windows left to read; the next --walk-back run resumes there.`;
    if (walk.checked) note += ` ${walk.checked} dated ads fell inside their windows.`;
    if (walk.truncated.length) note += ` ${walk.truncated.length} single days came back full, so they may hold more ads.`;
    if (walk.stoppedAtMax) note += ` Stopped at --max ${opts.max} before the oldest month.`;
  } else {
    const known = opts.known;
    // Newest first: once a full page has none of the advertiser's ads that the last run didn't have, stop.
    const stopAfterPage = known ? (page: AdLibraryApiAd[]) => !page.some((ad) => isCompanyAd(ad, companyId) && !known.has(ad.detailId)) : undefined;
    let result: AdLibraryApiResult;
    try {
      result = await opts.search({
        advertiser,
        max: opts.max,
        ...(opts.countries?.length ? { countries: opts.countries } : {}),
        ...(stopAfterPage ? { stopAfterPage } : {}),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      });
    } catch (e) {
      if (!(e instanceof AdLibraryStopError)) throw e;
      stopped = e;
      result = { fetched: e.partial?.fetched ?? 0, ads: e.partial?.ads ?? [] };
    }
    own = result.ads.filter((ad) => isCompanyAd(ad, companyId));
    fetched = result.fetched;
    note = `Kept ${own.length} of ${result.fetched} results for company ${companyId}${known ? ", reading newest first until a page held nothing new" : ""}.`;
  }
  const candidates = own.map((ad): Candidate => {
    const raw = (ad.raw ?? {}) as { details?: { adStatistics?: { totalImpressions?: unknown } } };
    const d = ad.detail;
    const firstShown = d?.ranFrom ?? null;
    const lastShown = d?.ranTo ?? null;
    const impressions = linkedinImpressions(raw.details?.adStatistics?.totalImpressions, opts.checkedAt);
    const format = linkedinFormat(d?.format ?? ad.format);
    const notes = ["LinkedIn's API returns no copy or image. Open the Ad Library page to read the creative."];
    const months = walk?.served[ad.detailId] ?? [];
    const floor = walk ? servedFloor(months, walk) : undefined;
    if (!firstShown) notes.push("No run dates or impressions: LinkedIn reports them only for ads served in the EU.");
    if (months.length)
      notes.push(
        `LinkedIn's date filter lists it as served in ${months.length} month${months.length === 1 ? "" : "s"}: ${months.join(", ")}${floor === "lookback" ? ". The first is a floor: the filter reaches back about 12 months" : floor === "unread" ? ". The first may be later than the true start: an earlier month wasn't read in full" : ""}.`,
      );
    if (format === "other") notes.push(`Format code ${d?.format ?? ad.format ?? "missing"} isn't mapped; set the format after inspecting the ad.`);
    if (d?.targeting?.length) {
      const included = d.targeting.filter((t) => t.included.length).map((t) => t.facet);
      const excluded = d.targeting.filter((t) => t.excluded.length).map((t) => t.facet);
      notes.push(
        `Targeting facets: ${included.join(", ") || "none listed"}${excluded.length ? `; excludes ${excluded.join(", ")}` : ""}.`,
      );
    }
    return {
      platform: "linkedin",
      source: { type: "linkedin-ad-library", adId: ad.detailId, url: ad.detailUrl, route: "official-api" },
      advertiser: { name: opts.entry.name, platformId: companyId, ...(opts.entry.domain ? { domain: opts.entry.domain } : {}) },
      ...(ad.advertiser ? { sourceAdvertiserName: ad.advertiser } : {}),
      category: opts.entry.category ?? opts.category,
      format,
      ...((d?.format ?? ad.format) ? { sourceFormat: d?.format ?? ad.format } : {}),
      copy: null,
      creativeRefs: [],
      firstShown,
      lastShown,
      live: liveFromLastShown(lastShown, opts.checkedAt),
      ...(months.length ? { servedMonths: months, ...(floor ? { servedMonthsFloor: floor } : {}) } : {}),
      regions: (d?.impressionsByCountry ?? []).map((c) => c.country).filter(Boolean),
      metrics: impressions ? [impressions] : [],
      notes,
      checkedAt: opts.checkedAt,
    };
  });
  return {
    candidates: candidates.filter((c) => c.source.adId),
    fetched,
    note,
    ...(walk ? { walk: { months: walk.months, remaining: walk.remaining, truncated: walk.truncated, incomplete: walk.incomplete } } : {}),
    ...(stopped ? { stopped } : {}),
  };
}
