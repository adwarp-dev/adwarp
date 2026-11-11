/**
 * Long-runner discovery for LinkedIn, by walking back 1 calendar month at a time.
 *
 * The Ad Library API returns an advertiser's newest ads first, 25 a page, so for a heavy advertiser the ads that
 * started long ago and still run sit behind every newer one (a live pull of Ramp's newest 200 returned 194, all first
 * shown between November 5 and 11, 2026). Asking for 1 month at a time reaches them.
 *
 * `dateRange` isn't documented (Microsoft Learn has no Ad Library API page). It was verified with live read-only calls
 * on 2026-11-11, in the reporting shape core sends, `(start:(year,month,day),end:(year,month,day))`:
 * - It filters to ads SERVED during the range, not created in it: Ramp's total fell from 13,081 to 3,701 for February
 *   2026, and the same AirPods ads came back month after month from April to October.
 * - It reaches back about 12 months: every month of 2025 before December returned nothing.
 * - A range that ends today or later returns nothing, so the newest window ends yesterday.
 * - It works for ads never served in the EU, which carry no dates. For them, the months the filter lists are the
 *   only run evidence LinkedIn gives.
 * Whether its end is inclusive isn't known, so each window sends its own last day as the end: at worst a month's last
 * day is missed, and an ad is never credited to a month it may not have run in.
 *
 * The walk still checks every dated ad against its window and stops with DateRangeMismatchError if one falls
 * outside, in case LinkedIn changes the parameter.
 */
import type { AdLibraryApiAd, DateRange } from "@adwarp/core";
import { isCompanyAd } from "@adwarp/core";
import { addDays } from "../parse.js";
import { daysBetween } from "../record.js";
import type { LinkedInSearch } from "./linkedin.js";

/** A window of days, `start` inclusive and `end` exclusive, as YYYY-MM-DD. Always inside 1 calendar month. */
export interface DayWindow {
  start: string;
  end: string;
}

/** How far back LinkedIn's date filter reaches, in calendar months counting the current one. */
export const LINKEDIN_LOOKBACK_MONTHS = 12;

/**
 * Ads read per window before it counts as full and is split. Adwarp's own budget, not a LinkedIn limit: served-during
 * means a busy advertiser's month holds thousands of ads (Ramp's February held 3,701).
 */
export const DEFAULT_WINDOW_CAP = 1000;

export class DateRangeMismatchError extends Error {
  constructor(detail: string) {
    super(`LinkedIn's dateRange didn't behave as verified: ${detail}. Run without --walk-back, with a higher --max to page further back.`);
    this.name = "DateRangeMismatchError";
  }
}

export const monthOf = (day: string): string => day.slice(0, 7);
const firstOfMonth = (day: string): string => `${monthOf(day)}-01`;
export const lastDayOf = (w: DayWindow): string => addDays(w.end, -1);

/**
 * Calendar months back from yesterday, newest first: the current month up to yesterday, then whole months, `months`
 * windows in all (12, LinkedIn's lookback, at most).
 */
export function planMonths(checkedAt: string, months: number = LINKEDIN_LOOKBACK_MONTHS): DayWindow[] {
  if (!Number.isInteger(months) || months < 1 || months > LINKEDIN_LOOKBACK_MONTHS)
    throw new Error(`months must be 1 to ${LINKEDIN_LOOKBACK_MONTHS}: LinkedIn's date filter reaches back about 12 months`);
  const windows: DayWindow[] = [];
  let end = checkedAt; // exclusive, so the newest window's last day is yesterday
  for (let i = 0; i < months; i++) {
    const start = firstOfMonth(addDays(end, -1));
    windows.push({ start, end });
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

/**
 * The window in core's DateRange shape, ending on its own last day. A range ending today or later returns nothing
 * from LinkedIn, so it is refused rather than sent.
 */
export function toDateRange(w: DayWindow, today: string): DateRange {
  const last = lastDayOf(w);
  if (last >= today) throw new Error(`A dateRange can't end on ${last}: LinkedIn returns nothing for a range ending today (${today}) or later.`);
  const part = (day: string) => {
    const [year, month, d] = day.split("-").map(Number);
    return { year: year ?? 0, month: month ?? 0, day: d ?? 0 };
  };
  return { start: part(w.start), end: part(last) };
}

/**
 * Why a dated ad can't belong to the window, or null. Served-during means its run touches the window; 1 day of
 * slack on each side covers time zones. Undated ads (never served in the EU) can't be checked and return null.
 */
export function windowConflict(ad: AdLibraryApiAd, w: DayWindow): string | null {
  const from = ad.detail?.ranFrom;
  const to = ad.detail?.ranTo ?? from;
  if (!from || !to) return null;
  if (from <= w.end && to >= addDays(w.start, -1)) return null;
  return `ad ${ad.detailId} ran ${from} to ${to}, outside the requested ${w.start} to ${lastDayOf(w)}`;
}

export interface WalkOptions {
  search: LinkedInSearch;
  advertiser: string;
  companyId: string;
  countries?: string[];
  /** From planMonths: newest first, each inside 1 calendar month. */
  windows: DayWindow[];
  /** The check day: no window may end on it or later. */
  checkedAt: string;
  /** Stop once this many of the company's ads are found. */
  max: number;
  /** Ads read per window before it is split. Default DEFAULT_WINDOW_CAP. */
  windowCap?: number;
  onProgress?: (message: string) => void;
}

export interface WalkResult {
  /** The company's ads, each once, in the order first found (newest window first). */
  ads: AdLibraryApiAd[];
  /** Per ad ID, the months (YYYY-MM, oldest first) the date filter listed it as served. */
  served: Record<string, string[]>;
  /** The months planned, oldest first. */
  months: string[];
  /** Months not read in full: a day that still came back full, or a month the walk stopped before. */
  incomplete: string[];
  /** Ads returned by every query, the company's or not. */
  fetched: number;
  queries: number;
  /** 1-day windows that still came back full: that day may hold more ads than the walk read. */
  truncated: DayWindow[];
  /** Dated ads checked against their window. */
  checked: number;
  /** True when the walk stopped at `max` before the oldest window. */
  stoppedAtMax: boolean;
}

export async function walkLinkedIn(opts: WalkOptions): Promise<WalkResult> {
  const cap = opts.windowCap ?? DEFAULT_WINDOW_CAP;
  for (const w of opts.windows) {
    if (monthOf(w.start) !== monthOf(lastDayOf(w))) throw new Error(`Window ${w.start} to ${lastDayOf(w)} crosses a month; use planMonths.`);
    toDateRange(w, opts.checkedAt); // refuses a window ending today or later before any call
  }
  const queue = [...opts.windows];
  const found = new Map<string, AdLibraryApiAd>();
  const served = new Map<string, Set<string>>();
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
        dateRange: toDateRange(w, opts.checkedAt),
        ...(opts.countries?.length ? { countries: opts.countries } : {}),
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (queries === 0 && status && status >= 400 && status < 500 && status !== 429)
        throw new DateRangeMismatchError(`LinkedIn answered ${status} to the first window (${(err as Error).message})`);
      throw err;
    }
    queries++;
    fetched += res.ads.length;

    for (const ad of res.ads) {
      const conflict = windowConflict(ad, w);
      if (conflict) throw new DateRangeMismatchError(conflict);
      if (ad.detail?.ranFrom) checked++;
    }
    if (res.ads.length >= cap) {
      const halves = splitWindow(w);
      if (halves) {
        opts.onProgress?.(`${opts.advertiser}: ${w.start} to ${lastDayOf(w)} is full, splitting it`);
        queue.unshift(...halves);
        continue;
      }
      truncated.push(w);
    }
    const month = monthOf(w.start);
    for (const ad of res.ads) {
      if (!isCompanyAd(ad, opts.companyId)) continue;
      if (!found.has(ad.detailId)) found.set(ad.detailId, ad);
      served.set(ad.detailId, (served.get(ad.detailId) ?? new Set()).add(month));
    }
    opts.onProgress?.(`${opts.advertiser}: ${w.start} to ${lastDayOf(w)}, ${found.size} ads so far`);
  }

  const months = opts.windows.map((w) => monthOf(w.start)).reverse();
  const incomplete = new Set([...truncated, ...queue].map((w) => monthOf(w.start)));
  const ads = [...found.values()].slice(0, opts.max);
  return {
    ads,
    served: Object.fromEntries(ads.map((a) => [a.detailId, [...(served.get(a.detailId) ?? [])].sort()])),
    months: [...new Set(months)],
    incomplete: [...incomplete].sort(),
    fetched,
    queries,
    truncated,
    checked,
    stoppedAtMax: queue.length > 0,
  };
}

/**
 * Whether an ad's first served month may be later than its true start: "lookback" when it is the oldest month the walk
 * asked about (LinkedIn's filter reaches no further), "unread" when an earlier month wasn't read in full. Undefined
 * when every earlier month was read in full and didn't list it.
 */
export function servedFloor(servedMonths: string[], walk: Pick<WalkResult, "months" | "incomplete">): "lookback" | "unread" | undefined {
  const first = servedMonths[0];
  if (!first) return undefined;
  if (first <= (walk.months[0] ?? first)) return "lookback";
  return walk.incomplete.some((m) => m < first) ? "unread" : undefined;
}
