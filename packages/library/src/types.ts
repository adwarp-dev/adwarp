import type { NewAdsReport } from "./changes.js";
import type { AdCopy, AdFormat, AdMetric, AdPlatform, AdRoute, AdSourceType } from "./record.js";

/**
 * 1 ad as a collector saw it, before ranking. Every adapter produces this shape from its platform's own
 * response, keeping each number exactly as the source reported it (see AdMetric in record.ts). A metric the
 * source didn't report is left out, never set to 0.
 */
export interface Candidate {
  platform: AdPlatform;
  source: { type: AdSourceType; adId: string; url: string; route: AdRoute; provider?: string };
  /** The watchlist's name for the advertiser, plus the platform's own ID for it when known. */
  advertiser: { name: string; platformId?: string; domain?: string };
  /** The advertiser name exactly as the source printed it. */
  sourceAdvertiserName?: string;
  category: string;
  format: AdFormat;
  /** The format exactly as the source labelled it, such as SPONSORED_STATUS_UPDATE. */
  sourceFormat?: string;
  copy: AdCopy | null;
  /**
   * Media references (image and video URLs without their query strings), used only to group near-identical ads
   * into creative families. Records never store them: signed CDN URLs expire and aren't ours to republish.
   */
  creativeRefs: string[];
  firstShown: string | null;
  lastShown: string | null;
  /**
   * LinkedIn walk-back only: the months (YYYY-MM, oldest first) LinkedIn's date filter lists the ad as served in. For
   * ads never served in the EU these are the only run evidence. Not part of the website's record format yet.
   */
  servedMonths?: string[];
  /** Why the first served month may be later than the true start: LinkedIn's 12-month lookback, or an unread month. */
  servedMonthsFloor?: "lookback" | "unread";
  /** Still serving when checked. null when the source doesn't say. */
  live: boolean | null;
  regions: string[];
  metrics: AdMetric[];
  notes: string[];
  /** YYYY-MM-DD the collector read the source. */
  checkedAt: string;
}

/** What `adwarp library collect` writes and `adwarp library drafts` reads. */
export interface CandidatesFile {
  version: 1;
  platform: AdPlatform;
  collectedAt: string;
  watchlist?: string;
  query: { countries?: string[]; max: number; walkBack?: { months: number; windowCap?: number } };
  /** Advertisers pulled without an error, including those with no ads. New-ad detection uses it. */
  tracked?: string[];
  /** What changed since the previous run, when collect ran with --previous. */
  changes?: NewAdsReport;
  candidates: Candidate[];
  /** Watchlist entries with no ID or name for this platform. */
  skipped: { advertiser: string; reason: string }[];
  /** Per-advertiser failures. 1 failure never stops the rest of the run. */
  errors: { advertiser: string; message: string }[];
}

/** Every adapter accepts an injected fetch, so tests run on fixtures and never touch the network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
