/**
 * Long-runner discovery for LinkedIn, by walking back in date windows.
 *
 * The Ad Library API returns an advertiser's newest ads first, 25 a page, so for a heavy advertiser the ads that
 * started long ago and still run sit behind every newer one (a live pull of Ramp's newest 200 returned 194, all first
 * shown between November 5 and 11, 2026). Asking for 1 window at a time, newest first, reaches them sooner.
 *
 * UNVERIFIED: the API's `dateRange` parameter is not documented (Microsoft Learn has no Ad Library API page). Some
 * third-party clients send it in the reporting shape, which is what core sends. So the walk checks every answer and
 * stops with DateRangeUnverifiedError instead of trusting it: a dated ad whose run doesn't touch the requested window
 * means LinkedIn ignored or reinterpreted the range, and a 4xx on the first window means it rejected the parameter.
 * Only ads served in the EU carry dates, so a walk that saw none reports `checked: 0`: the range was never tested.
 */
import type { AdLibraryApiAd, DateRange } from "@adwarp/core";
import { isCompanyAd } from "@adwarp/core";
import { addDays } from "../parse.js";
import { daysBetween } from "../record.js";
import type { LinkedInSearch } from "./linkedin.js";

/** A window of days, `start` inclusive and `end` exclusive, as YYYY-MM-DD. */
export interface DayWindow {
  start: string;
  end: string;
}

/**
 * Ads per window query before the window counts as full and is split. Adwarp's own budget (the competitor tool's
 * limit), not a documented LinkedIn limit.
 */
export const LINKEDIN_QUERY_CAP = 500;

export class DateRangeUnverifiedError extends Error {
  constructor(detail: string) {
    super(
      `LinkedIn's dateRange can't be trusted: ${detail}. Run without --walk-back, with a higher --max to page further back.`,
    );
    this.name = "DateRangeUnverifiedError";
  }
}

/**
 * Windows of `windowDays` from the check day back `days` days, newest first. The newest ends the day after the
 * check (end is exclusive), and the oldest is cut at the start of the range.
 */
export function planWindows(checkedAt: string, days: number, windowDays: number): DayWindow[] {
  if (days < 1 || windowDays < 1) throw new Error("days and windowDays must be 1 or more");
  const floor = addDays(checkedAt, -(days - 1));
  const windows: DayWindow[] = [];
  let end = addDays(checkedAt, 1);
  while (end > floor) {
    const start = addDays(end, -windowDays);
    windows.push({ start: start < floor ? floor : start, end });
    end = start;
  }
  return windows;
}

/** The 2 halves of a window, newer first, or null for a 1-day window. */
export function splitWindow(w: DayWindow): [DayWindow, DayWindow] | null {
  const days = daysBetween(w.start, w.end);
  if (days <= 1) return null;
  const mid = addDays(w.start, Math.floor(days / 2));
  return [
    { start: mid, end: w.end },
    { start: w.start, end: mid },
  ];
}

/** The window in core's DateRange shape. End is sent as the exclusive bound; the 1-day overlap is deduplicated. */
export function toDateRange(w: DayWindow): DateRange {
  const part = (day: string) => {
    const [year, month, d] = day.split("-").map(Number);
    return { year: year ?? 0, month: month ?? 0, day: d ?? 0 };
  };
  return { start: part(w.start), end: part(w.end) };
}

/**
 * Why a dated ad can't belong to the window, or null. An ad belongs when its run touches the window, with 1 day of
 * slack on each side for time zones and an inclusive or exclusive end. Undated ads (served outside the EU) can't be
 * checked and return null.
 */
export function windowConflict(ad: AdLibraryApiAd, w: DayWindow): string | null {
  const from = ad.detail?.ranFrom;
  const to = ad.detail?.ranTo ?? from;
  if (!from || !to) return null;
  if (from <= addDays(w.end, 1) && to >= addDays(w.start, -1)) return null;
  return `ad ${ad.detailId} ran ${from} to ${to}, outside the requested ${w.start} to ${w.end}`;
}

export interface WalkOptions {
  search: LinkedInSearch;
  advertiser: string;
  companyId: string;
  countries?: string[];
  windows: DayWindow[];
  /** Stop once this many of the company's ads are found. */
  max: number;
  /** Ads per query before a window counts as full. Default LINKEDIN_QUERY_CAP. */
  windowCap?: number;
  onProgress?: (message: string) => void;
}

export interface WalkResult {
  /** The company's ads, newest window first, each once. */
  ads: AdLibraryApiAd[];
  /** Ads returned by every query, the company's or not. */
  fetched: number;
  queries: number;
  /** 1-day windows that still came back full: that day may hold more ads than the walk read. */
  truncated: DayWindow[];
  /** Dated ads checked against their window. 0 means the check never ran. */
  checked: number;
  /** True when the walk stopped at `max` before the oldest window. */
  stoppedAtMax: boolean;
}

export async function walkLinkedIn(opts: WalkOptions): Promise<WalkResult> {
  const cap = opts.windowCap ?? LINKEDIN_QUERY_CAP;
  const queue = [...opts.windows];
  const found = new Map<string, AdLibraryApiAd>();
  const truncated: DayWindow[] = [];
  let fetched = 0;
  let queries = 0;
  let checked = 0;

  while (queue.length && found.size < opts.max) {
    const w = queue.shift() as DayWindow;
    let res;
    try {
      res = await opts.search({
        advertiser: opts.advertiser,
        max: cap,
        dateRange: toDateRange(w),
        ...(opts.countries?.length ? { countries: opts.countries } : {}),
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (queries === 0 && status && status >= 400 && status < 500 && status !== 429)
        throw new DateRangeUnverifiedError(`LinkedIn answered ${status} to the first window (${(err as Error).message})`);
      throw err;
    }
    queries++;
    fetched += res.ads.length;

    for (const ad of res.ads) {
      const conflict = windowConflict(ad, w);
      if (conflict) throw new DateRangeUnverifiedError(conflict);
      if (ad.detail?.ranFrom) checked++;
    }
    if (res.ads.length >= cap) {
      const halves = splitWindow(w);
      if (halves) {
        opts.onProgress?.(`${opts.advertiser}: ${w.start} to ${w.end} is full, splitting it`);
        queue.unshift(...halves);
        continue;
      }
      truncated.push(w);
    }
    for (const ad of res.ads) if (isCompanyAd(ad, opts.companyId) && !found.has(ad.detailId)) found.set(ad.detailId, ad);
    opts.onProgress?.(`${opts.advertiser}: ${w.start} to ${w.end}, ${found.size} ads so far`);
  }
  return { ads: [...found.values()].slice(0, opts.max), fetched, queries, truncated, checked, stoppedAtMax: queue.length > 0 };
}

