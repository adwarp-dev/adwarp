/**
 * Runs 1 platform's adapter over a watchlist and returns a candidates file. Entries without an ID for the platform
 * are skipped (a loose name search returns lookalike advertisers), and 1 advertiser's failure is recorded without
 * stopping the others. Credentials come only from ADWARP_LIBRARY_* (credentials.ts).
 */
import { collectGoogle, DEFAULT_GOOGLE_MAX_BYTES } from "./adapters/google.js";
import { collectLinkedIn, linkedinLibrarySearch, type LinkedInSearch } from "./adapters/linkedin.js";
import { collectMeta } from "./adapters/meta.js";
import { collectTikTok, tiktokAccessToken } from "./adapters/tiktok.js";
import { googleLibraryCredentials, type LibraryEnv, metaLibraryCredentials, tiktokLibraryCredentials } from "./credentials.js";
import { isoDay } from "./parse.js";
import type { AdPlatform } from "./record.js";
import type { Candidate, CandidatesFile, FetchLike } from "./types.js";
import type { Watchlist, WatchlistEntry } from "./watchlist.js";

export interface CollectOptions {
  platform: AdPlatform;
  watchlist: Watchlist;
  /** Shown in the candidates file. */
  watchlistPath?: string;
  /** Replaces the watchlist's countries for this platform. */
  countries?: string[];
  /** Ads per advertiser. Default 100, or 5000 with walkBack. */
  max?: number;
  /** LinkedIn only: walk back in date windows (unverified, see adapters/linkedinWindows.ts). */
  walkBack?: { days: number; windowDays: number };
  /** Only ads shown within this many days (Google, Meta and TikTok). Default 365. */
  days?: number;
  /** Google only: the most bytes BigQuery may scan. */
  maxBytes?: number;
  checkedAt?: string;
  env?: LibraryEnv;
  /** Injected in tests. */
  fetch?: FetchLike;
  linkedinSearch?: LinkedInSearch;
  delayScale?: number;
  onProgress?: (message: string) => void;
}

const hasId: Record<AdPlatform, (e: WatchlistEntry) => boolean> = {
  linkedin: (e) => Boolean(e.linkedin?.companyId),
  google: (e) => Boolean(e.google?.advertiserIds?.length || e.google?.disclosedName),
  meta: (e) => Boolean(e.meta?.pageIds?.length),
  tiktok: (e) => Boolean(e.tiktok?.businessIds?.length),
};

const ID_HINT: Record<AdPlatform, string> = {
  linkedin: "no linkedin.companyId",
  google: "no google.advertiserIds or google.disclosedName",
  meta: "no meta.pageIds",
  tiktok: "no tiktok.businessIds",
};

export async function collect(opts: CollectOptions): Promise<CandidatesFile> {
  const { platform, watchlist } = opts;
  const checkedAt = opts.checkedAt ?? isoDay();
  const max = opts.max ?? (opts.walkBack ? 5000 : 100);
  if (opts.walkBack && platform !== "linkedin") throw new Error("--walk-back is for LinkedIn only; the other libraries already take a date range.");
  const env = opts.env ?? process.env;
  const countries = (opts.countries ?? watchlist.countries?.[platform] ?? []).map((c) => c.toUpperCase());
  const progress = opts.onProgress ?? (() => {});
  const fetchImpl = opts.fetch ?? fetch;
  const delay = opts.delayScale !== undefined ? { delayScale: opts.delayScale } : {};

  const entries = watchlist.advertisers.filter(hasId[platform]);
  const skipped = watchlist.advertisers
    .filter((e) => !hasId[platform](e))
    .map((e) => ({ advertiser: e.name, reason: ID_HINT[platform] }));
  const candidates: Candidate[] = [];
  const errors: CandidatesFile["errors"] = [];
  const tracked: string[] = [];

  if ((platform === "meta" || platform === "tiktok") && !countries.length)
    throw new Error(`${platform} needs countries: set countries.${platform} in the watchlist or pass --country, such as DE,FR`);

  if (platform === "google" && entries.length) {
    const creds = googleLibraryCredentials(env);
    try {
      const res = await collectGoogle({
        entries,
        category: watchlist.category,
        checkedAt,
        max,
        countries,
        ...creds,
        days: opts.days ?? 365,
        maxBytes: opts.maxBytes ?? DEFAULT_GOOGLE_MAX_BYTES,
        fetch: fetchImpl,
        onProgress: progress,
        ...delay,
      });
      candidates.push(...res.candidates);
      tracked.push(...entries.map((e) => e.name));
      progress(`Google: ${res.candidates.length} ads from ${res.fetched} rows.`);
    } catch (err) {
      errors.push({ advertiser: "all (1 BigQuery query)", message: (err as Error).message });
    }
  } else if (entries.length) {
    // Build the platform's client once, before the loop, so missing credentials fail the run right away.
    let run: (entry: WatchlistEntry) => Promise<Candidate[]>;
    if (platform === "linkedin") {
      const search = opts.linkedinSearch ?? (await linkedinLibrarySearch(env));
      run = async (entry) => {
        const res = await collectLinkedIn({
          entry,
          category: watchlist.category,
          checkedAt,
          max,
          countries,
          search,
          ...(opts.walkBack ? { walkBack: opts.walkBack } : {}),
          onProgress: progress,
        });
        progress(`${entry.name}: ${res.note}`);
        return res.candidates;
      };
    } else if (platform === "meta") {
      const creds = metaLibraryCredentials(env);
      run = async (entry) =>
        (await collectMeta({ entry, category: watchlist.category, checkedAt, max, countries, ...creds, fetch: fetchImpl, ...delay })).candidates;
    } else {
      const creds = tiktokLibraryCredentials(env);
      const accessToken = await tiktokAccessToken(creds.clientKey, creds.clientSecret, fetchImpl);
      run = async (entry) =>
        (
          await collectTikTok({
            entry,
            category: watchlist.category,
            checkedAt,
            max,
            countries,
            accessToken,
            days: opts.days ?? 365,
            fetch: fetchImpl,
            ...delay,
          })
        ).candidates;
    }
    for (const entry of entries) {
      try {
        const found = await run(entry);
        candidates.push(...found);
        tracked.push(entry.name);
        progress(`${entry.name}: ${found.length} ads.`);
      } catch (err) {
        errors.push({ advertiser: entry.name, message: (err as Error).message });
      }
    }
  }

  return {
    version: 1,
    platform,
    collectedAt: checkedAt,
    ...(opts.watchlistPath ? { watchlist: opts.watchlistPath } : {}),
    query: { ...(countries.length ? { countries } : {}), max, ...(opts.walkBack ? { walkBack: opts.walkBack } : {}) },
    tracked,
    candidates,
    skipped,
    errors,
  };
}

/** Checks a candidates file read back from disk. */
export function parseCandidatesFile(raw: unknown): CandidatesFile {
  const f = raw as Partial<CandidatesFile>;
  if (!f || typeof f !== "object" || f.version !== 1 || !Array.isArray(f.candidates) || typeof f.platform !== "string")
    throw new Error("Not a candidates file from `adwarp library collect` (version 1).");
  return f as CandidatesFile;
}
