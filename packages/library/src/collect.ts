/**
 * Runs 1 platform's adapter over a watchlist and returns a candidates file. Entries without an ID for the platform
 * are skipped (a loose name search returns lookalike advertisers), and 1 advertiser's failure is recorded without
 * stopping the others. Credentials come only from ADWARP_LIBRARY_* (credentials.ts).
 *
 * LinkedIn is the exception to "1 failure never stops the others": a 429, a 401 or 403, or a spent daily budget
 * stops the whole run (the quota is per app, so the next advertiser would only spend more of it). The ads read until
 * then are kept, and the advertisers not reached go in `errors`, so they keep their last ads.
 */
import type { AdLibraryGuard } from "@adwarp/core";
import { collectGoogle, DEFAULT_GOOGLE_MAX_BYTES } from "./adapters/google.js";
import { collectLinkedIn, createLinkedInLibrarySearch, type LinkedInSearch } from "./adapters/linkedin.js";
import { lastDayOf, monthOf, servedFloor } from "./adapters/linkedinWindows.js";
import { trackedIn } from "./changes.js";
import { collectMeta } from "./adapters/meta.js";
import { collectTikTok, tiktokAccessToken } from "./adapters/tiktok.js";
import { googleLibraryCredentials, type LibraryEnv, metaLibraryCredentials, tiktokLibraryCredentials } from "./credentials.js";
import { isoDay } from "./parse.js";
import { type AdPlatform, daysBetween } from "./record.js";
import type { Candidate, CandidatesFile, FetchLike, WalkRecord } from "./types.js";
import type { Watchlist, WatchlistEntry } from "./watchlist.js";

export interface CollectOptions {
  platform: AdPlatform;
  watchlist: Watchlist;
  /** Shown in the candidates file. */
  watchlistPath?: string;
  /** Replaces the watchlist's countries for this platform. */
  countries?: string[];
  /** Ads per advertiser. Default 100, or 20000 with walkBack. */
  max?: number;
  /** LinkedIn only: walk back 1 calendar month at a time (see adapters/linkedinWindows.ts). */
  walkBack?: { months: number; windowCap?: number };
  /**
   * The last run's candidates file. On LinkedIn it makes the pull incremental (see `incremental`), keeps each
   * advertiser's earlier ads, and lets --walk-back resume and skip advertisers walked back in the last 7 days.
   */
  previous?: CandidatesFile;
  /** LinkedIn with `previous`: read newest first and stop at the first full page with nothing new. Default true. */
  incremental?: boolean;
  /** LinkedIn: walk back even an advertiser walked back in the last 7 days, and start over instead of resuming. */
  force?: boolean;
  /** LinkedIn: Ad Library calls a day for this app. Default 300, or ADWARP_LIBRARY_LINKEDIN_DAILY_CALLS. */
  dailyCalls?: number;
  /** LinkedIn: where the daily call counts live (see core's adLibraryStateDir). */
  stateDir?: string;
  /** Only ads shown within this many days (Google, Meta and TikTok). Default 365. */
  days?: number;
  /** Google only: the most bytes BigQuery may scan. */
  maxBytes?: number;
  checkedAt?: string;
  env?: LibraryEnv;
  /** Injected in tests. */
  fetch?: FetchLike;
  linkedinSearch?: LinkedInSearch;
  linkedinGuard?: AdLibraryGuard;
  delayScale?: number;
  onProgress?: (message: string) => void;
}

const hasId: Record<AdPlatform, (e: WatchlistEntry) => boolean> = {
  linkedin: (e) => Boolean(e.linkedin?.companyId),
  google: (e) => Boolean(e.google?.advertiserIds?.length || e.google?.disclosedName),
  meta: (e) => Boolean(e.meta?.pageIds?.length),
  tiktok: (e) => Boolean(e.tiktok?.businessIds?.length),
};

/** Days before an advertiser can be walked back again without --force. */
export const WALK_BACK_COOLDOWN_DAYS = 7;

/**
 * 1 advertiser's ads from this run merged with its ads from the last: this run's version of each ad wins, served
 * months from both are kept, and ads this run didn't read (an incremental pull stops early) stay.
 */
export function mergeCandidates(before: Candidate[], fresh: Candidate[]): Candidate[] {
  const old = new Map(before.map((c) => [c.source.adId, c]));
  const seen = new Set<string>();
  const merged = fresh.map((c) => {
    seen.add(c.source.adId);
    const prev = old.get(c.source.adId);
    const months = [...new Set([...(prev?.servedMonths ?? []), ...(c.servedMonths ?? [])])].sort();
    if (!months.length) return c;
    const floor = c.servedMonthsFloor ?? prev?.servedMonthsFloor;
    return { ...c, servedMonths: months, ...(floor ? { servedMonthsFloor: floor } : {}) };
  });
  return [...merged, ...before.filter((c) => !seen.has(c.source.adId))];
}

const ID_HINT: Record<AdPlatform, string> = {
  linkedin: "no linkedin.companyId",
  google: "no google.advertiserIds or google.disclosedName",
  meta: "no meta.pageIds",
  tiktok: "no tiktok.businessIds",
};

export async function collect(opts: CollectOptions): Promise<CandidatesFile> {
  const { platform, watchlist } = opts;
  const checkedAt = opts.checkedAt ?? isoDay();
  // A walk reads every ad served in each month, long runners included: Ramp lists about 13,000 within the lookback.
  const max = opts.max ?? (opts.walkBack ? 20000 : 100);
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
  const walks: Record<string, WalkRecord> = { ...(opts.previous?.walks ?? {}) };
  let stopped: CandidatesFile["stopped"];
  let calls: CandidatesFile["calls"];

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
  } else if (platform === "linkedin" && entries.length) {
    let search = opts.linkedinSearch;
    let guard = opts.linkedinGuard;
    if (!search) {
      const made = await createLinkedInLibrarySearch(env, {
        ...(opts.dailyCalls !== undefined ? { dailyCalls: opts.dailyCalls } : {}),
        ...(opts.stateDir ? { stateDir: opts.stateDir } : {}),
      });
      search = made.search;
      guard = made.guard;
    }
    if (guard?.budget) progress(`${await guard.budget.remaining()} of ${guard.budget.limit} Ad Library calls left today for this app (UTC).`);
    const previous = opts.previous;
    const before = (name: string) => previous?.candidates.filter((c) => c.advertiser.name === name) ?? [];
    const wasTracked = previous ? trackedIn(previous) : new Set<string>();

    for (const entry of entries) {
      if (stopped) {
        errors.push({ advertiser: entry.name, message: `Not reached: the run stopped (${stopped.reason}).` });
        continue;
      }
      const base = { entry, category: watchlist.category, checkedAt, max, countries, search, onProgress: progress };
      try {
        if (opts.walkBack) {
          const rec = previous?.walks?.[entry.name];
          if (rec?.done && daysBetween(rec.updatedAt, checkedAt) < WALK_BACK_COOLDOWN_DAYS && !opts.force) {
            skipped.push({ advertiser: entry.name, reason: `walked back on ${rec.updatedAt}; again after ${WALK_BACK_COOLDOWN_DAYS} days, or pass --force` });
            candidates.push(...before(entry.name));
            tracked.push(entry.name);
            continue;
          }
          // An unfinished walk resumes with the windows it hadn't read (any that now end today or later are dropped).
          const resume = !opts.force && rec && !rec.done && rec.remaining.length ? rec : undefined;
          const windows = resume?.remaining.filter((w) => lastDayOf(w) < checkedAt);
          const res = await collectLinkedIn({ ...base, walkBack: { ...opts.walkBack, ...(windows ? { windows } : {}) } });
          const walk = res.walk ?? { months: [], remaining: [], truncated: [], incomplete: [] };
          const months = resume ? resume.months : walk.months;
          const truncated = [...new Set([...(resume?.truncated ?? []), ...walk.truncated.map((w) => monthOf(w.start))])].sort();
          const incomplete = [...new Set([...truncated, ...walk.remaining.map((w) => monthOf(w.start))])].sort();
          const merged = mergeCandidates(before(entry.name), res.candidates).map((c) => {
            if (!c.servedMonths?.length) return c;
            const { servedMonthsFloor: _old, ...rest } = c;
            const floor = servedFloor(c.servedMonths, { months, incomplete });
            return floor ? { ...rest, servedMonthsFloor: floor } : rest;
          });
          candidates.push(...merged);
          walks[entry.name] = {
            startedAt: resume?.startedAt ?? checkedAt,
            updatedAt: checkedAt,
            done: !res.stopped && walk.remaining.length === 0,
            months,
            remaining: walk.remaining,
            truncated,
          };
          progress(`${entry.name}: ${res.note}`);
          if (res.stopped) stopped = { reason: res.stopped.reason, message: res.stopped.message };
          // A pull cut short counts as tracked only if the last run tracked it; otherwise its ads are a baseline.
          if (!res.stopped || wasTracked.has(entry.name)) tracked.push(entry.name);
        } else {
          const incremental = opts.incremental !== false && wasTracked.has(entry.name);
          const known = incremental ? new Set(before(entry.name).map((c) => c.source.adId)) : undefined;
          const res = await collectLinkedIn({ ...base, ...(known ? { known } : {}) });
          candidates.push(...(previous ? mergeCandidates(before(entry.name), res.candidates) : res.candidates));
          progress(`${entry.name}: ${res.note}`);
          if (res.stopped) stopped = { reason: res.stopped.reason, message: res.stopped.message };
          if (!res.stopped || wasTracked.has(entry.name)) tracked.push(entry.name);
        }
      } catch (err) {
        errors.push({ advertiser: entry.name, message: (err as Error).message });
      }
    }
    if (guard) {
      const left = guard.budget ? await guard.budget.remaining().catch(() => undefined) : undefined;
      calls = { made: guard.calls, ...(left !== undefined ? { leftToday: left } : {}), ...(guard.budget ? { dailyBudget: guard.budget.limit } : {}) };
    }
  } else if (entries.length) {
    // Build the platform's client once, before the loop, so missing credentials fail the run right away.
    let run: (entry: WatchlistEntry) => Promise<Candidate[]>;
    if (platform === "meta") {
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
    ...(Object.keys(walks).length ? { walks } : {}),
    ...(stopped ? { stopped } : {}),
    ...(calls ? { calls } : {}),
  };
}

/** Checks a candidates file read back from disk. */
export function parseCandidatesFile(raw: unknown): CandidatesFile {
  const f = raw as Partial<CandidatesFile>;
  if (!f || typeof f !== "object" || f.version !== 1 || !Array.isArray(f.candidates) || typeof f.platform !== "string")
    throw new Error("Not a candidates file from `adwarp library collect` (version 1).");
  return f as CandidatesFile;
}
