/**
 * Google Ads Transparency Center adapter, through Google's public BigQuery dataset
 * bigquery-public-data.google_ads_transparency_center.creative_stats (documented in Google's README at
 * https://storage.googleapis.com/ads-transparency-center/api-data/README.txt).
 *
 * Coverage: ads served in the European Economic Area and Turkey. Per ad and region it gives the first and last
 * shown dates and a lower and upper bound on times shown. It has no copy and no media, so an editor reads the ad on
 * its Transparency Center page.
 *
 * Cost: BigQuery bills the project in ADWARP_LIBRARY_GOOGLE_PROJECT for the bytes a query scans. Every query runs
 * as a dry run first and stops when the estimate passes `maxBytes`, and the real query carries maximumBytesBilled so
 * BigQuery itself refuses to scan more. All advertisers go in 1 query, so a run scans the table once.
 */
import { googleLibraryCredentials, type LibraryEnv } from "../credentials.js";
import { requestJson } from "../http.js";
import { addDays, toDay } from "../parse.js";
import { type AdFormat, type AdMetric, metricFloor } from "../record.js";
import type { Candidate, FetchLike } from "../types.js";
import type { WatchlistEntry } from "../watchlist.js";
import { liveFromLastShown } from "./linkedin.js";

export const GOOGLE_SOURCE = "Google Ads Transparency Center (BigQuery public dataset)";
export const GOOGLE_TABLE = "bigquery-public-data.google_ads_transparency_center.creative_stats";
/** 20 GiB: a few US cents at on-demand prices, and well inside BigQuery's free monthly terabyte. */
export const DEFAULT_GOOGLE_MAX_BYTES = 20 * 1024 ** 3;

export const GOOGLE_QUERY = `
SELECT
  c.advertiser_id,
  c.advertiser_disclosed_name,
  c.creative_id,
  c.creative_page_url,
  c.ad_format_type,
  r.region_code,
  CAST(r.first_shown AS STRING) AS first_shown,
  CAST(r.last_shown AS STRING) AS last_shown,
  r.times_shown_lower_bound,
  r.times_shown_upper_bound,
  CAST(r.times_shown_start_date AS STRING) AS times_shown_start_date,
  CAST(r.times_shown_end_date AS STRING) AS times_shown_end_date
FROM \`${GOOGLE_TABLE}\` AS c, UNNEST(c.region_stats) AS r
WHERE (c.advertiser_id IN UNNEST(@advertiser_ids) OR c.advertiser_disclosed_name IN UNNEST(@disclosed_names))
  AND (ARRAY_LENGTH(@regions) = 0 OR r.region_code IN UNNEST(@regions))
  AND CAST(r.last_shown AS STRING) >= @since
ORDER BY r.times_shown_lower_bound DESC
LIMIT @row_limit`.trim();

export interface GoogleRow {
  advertiser_id: string | null;
  advertiser_disclosed_name: string | null;
  creative_id: string | null;
  creative_page_url: string | null;
  ad_format_type: string | null;
  region_code: string | null;
  first_shown: string | null;
  last_shown: string | null;
  times_shown_lower_bound: string | null;
  times_shown_upper_bound: string | null;
  times_shown_start_date: string | null;
  times_shown_end_date: string | null;
}

interface QueryResult {
  jobComplete?: boolean;
  jobReference?: { projectId?: string; jobId?: string; location?: string };
  schema?: { fields?: { name: string }[] };
  rows?: { f: { v: unknown }[] }[];
  pageToken?: string;
  totalBytesProcessed?: string;
}

const arrayParam = (name: string, values: string[]) => ({
  name,
  parameterType: { type: "ARRAY", arrayType: { type: "STRING" } },
  parameterValue: { arrayValues: values.map((value) => ({ value })) },
});
const scalarParam = (name: string, type: "STRING" | "INT64", value: string) => ({
  name,
  parameterType: { type },
  parameterValue: { value },
});

export function googleFormat(type: string | null | undefined): AdFormat {
  switch ((type ?? "").toUpperCase()) {
    case "TEXT":
      return "text";
    case "IMAGE":
      return "display";
    case "VIDEO":
      return "video";
    default:
      return "other";
  }
}

const num = (v: string | null) => (v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
const fmtCount = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : String(n));

/** Times shown in 1 region, with the dates Google says the bounds cover. Undefined when Google reports none. */
export function googleTimesShown(row: GoogleRow, collectedAt: string): AdMetric | undefined {
  const lower = num(row.times_shown_lower_bound);
  const upper = num(row.times_shown_upper_bound);
  if (lower === undefined || !row.region_code) return undefined;
  const start = toDay(row.times_shown_start_date);
  const end = toDay(row.times_shown_end_date);
  return {
    name: "times-shown",
    kind: "range",
    lower,
    ...(upper !== undefined && upper >= lower ? { upper } : {}),
    text: upper !== undefined ? `${fmtCount(lower)}-${fmtCount(upper)}` : `${fmtCount(lower)}+`,
    geography: row.region_code,
    period: start && end ? `${start}/${end}` : "lifetime",
    source: GOOGLE_SOURCE,
    collectedAt,
  };
}

/** Groups 1 row per ad and region into 1 candidate per ad. Rows whose advertiser isn't on the watchlist are dropped. */
export function googleCandidates(rows: GoogleRow[], ctx: { entries: WatchlistEntry[]; category: string; checkedAt: string }): Candidate[] {
  const byId = new Map<string, WatchlistEntry>();
  const byName = new Map<string, WatchlistEntry>();
  for (const entry of ctx.entries) {
    for (const id of entry.google?.advertiserIds ?? []) byId.set(id, entry);
    if (entry.google?.disclosedName) byName.set(entry.google.disclosedName, entry);
  }
  const out = new Map<string, Candidate>();
  for (const row of rows) {
    if (!row.creative_id || !row.creative_page_url) continue;
    const entry = (row.advertiser_id && byId.get(row.advertiser_id)) || (row.advertiser_disclosed_name && byName.get(row.advertiser_disclosed_name));
    if (!entry) continue;
    let c = out.get(row.creative_id);
    if (!c) {
      const format = googleFormat(row.ad_format_type);
      const notes = ["Google's dataset has no copy or media. Open the Transparency Center page to read the ad."];
      if (format === "text") notes.push("Google labels it TEXT. Set the format to search once the page shows it ran on Search.");
      c = {
        platform: "google",
        source: { type: "google-ads-transparency", adId: row.creative_id, url: row.creative_page_url, route: "official-api" },
        advertiser: {
          name: entry.name,
          ...(row.advertiser_id ? { platformId: row.advertiser_id } : {}),
          ...(entry.domain ? { domain: entry.domain } : {}),
        },
        ...(row.advertiser_disclosed_name ? { sourceAdvertiserName: row.advertiser_disclosed_name } : {}),
        category: entry.category ?? ctx.category,
        format,
        ...(row.ad_format_type ? { sourceFormat: row.ad_format_type } : {}),
        copy: null,
        creativeRefs: [],
        firstShown: null,
        lastShown: null,
        live: null,
        regions: [],
        metrics: [],
        notes,
        checkedAt: ctx.checkedAt,
      };
      out.set(row.creative_id, c);
    }
    const first = toDay(row.first_shown);
    const last = toDay(row.last_shown);
    if (first && (!c.firstShown || first < c.firstShown)) c.firstShown = first;
    if (last && (!c.lastShown || last > c.lastShown)) c.lastShown = last;
    if (row.region_code && !c.regions.includes(row.region_code)) c.regions.push(row.region_code);
    const metric = googleTimesShown(row, ctx.checkedAt);
    if (metric && !c.metrics.some((m) => m.geography === metric.geography)) c.metrics.push(metric);
  }
  for (const c of out.values()) {
    c.live = liveFromLastShown(c.lastShown, ctx.checkedAt);
    // Strongest region first: it is the measure the ranking compares (record.ts exposureMetric takes the first).
    c.metrics.sort((a, b) => (metricFloor(b) ?? 0) - (metricFloor(a) ?? 0));
  }
  return [...out.values()];
}

/** BigQuery's row format ({ f: [{ v }] }) to named rows. */
export function namedRows(result: QueryResult): GoogleRow[] {
  const names = (result.schema?.fields ?? []).map((f) => f.name);
  return (result.rows ?? []).map((row) => {
    const out: Record<string, string | null> = {};
    names.forEach((name, i) => {
      const v = row.f[i]?.v;
      out[name] = v === null || v === undefined ? null : String(v);
    });
    return out as unknown as GoogleRow;
  });
}

export interface GoogleCollectOptions {
  entries: WatchlistEntry[];
  category: string;
  checkedAt: string;
  /** Ads per advertiser to keep, at most. */
  max: number;
  /** Region codes such as DE or EEA. Empty means every region in the dataset. */
  countries: string[];
  project: string;
  accessToken: string;
  /** Only ads last shown within this many days. Default 365. */
  days?: number;
  maxBytes?: number;
  fetch?: FetchLike;
  delayScale?: number;
  onProgress?: (message: string) => void;
}

export async function collectGoogle(opts: GoogleCollectOptions): Promise<{ candidates: Candidate[]; fetched: number; bytesProcessed: number }> {
  const ids = opts.entries.flatMap((e) => e.google?.advertiserIds ?? []);
  const names = opts.entries.flatMap((e) => (e.google?.disclosedName ? [e.google.disclosedName] : []));
  if (!ids.length && !names.length) throw new Error("No watchlist entry has google.advertiserIds or google.disclosedName");
  const fetchImpl = opts.fetch ?? fetch;
  const maxBytes = opts.maxBytes ?? DEFAULT_GOOGLE_MAX_BYTES;
  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(opts.project)}/queries`;
  const headers = { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" };
  const http = { name: "BigQuery", ...(opts.delayScale !== undefined ? { delayScale: opts.delayScale } : {}) };
  const request = {
    query: GOOGLE_QUERY,
    useLegacySql: false,
    parameterMode: "NAMED",
    queryParameters: [
      arrayParam("advertiser_ids", ids),
      arrayParam("disclosed_names", names),
      arrayParam("regions", opts.countries),
      scalarParam("since", "STRING", addDays(opts.checkedAt, -(opts.days ?? 365))),
      // Rows are 1 per ad and region; leave room for many regions per ad.
      scalarParam("row_limit", "INT64", String(opts.max * opts.entries.length * 40)),
    ],
  };

  const dry = await requestJson<QueryResult>(fetchImpl, url, { method: "POST", headers, body: JSON.stringify({ ...request, dryRun: true }) }, http);
  const estimate = Number(dry.totalBytesProcessed ?? NaN);
  if (!Number.isFinite(estimate)) throw new Error("BigQuery's dry run returned no byte estimate, so the query was not run.");
  if (estimate > maxBytes)
    throw new Error(
      `BigQuery would scan ${(estimate / 1024 ** 3).toFixed(1)} GiB, over the ${(maxBytes / 1024 ** 3).toFixed(1)} GiB limit. Raise --max-bytes to run it.`,
    );
  opts.onProgress?.(`BigQuery dry run: ${(estimate / 1024 ** 3).toFixed(2)} GiB to scan.`);

  let result = await requestJson<QueryResult>(
    fetchImpl,
    url,
    { method: "POST", headers, body: JSON.stringify({ ...request, maximumBytesBilled: String(maxBytes), timeoutMs: 60_000, maxResults: 10_000 }) },
    http,
  );
  const job = result.jobReference;
  const rows: GoogleRow[] = [];
  for (let polls = 0; polls < 30; polls++) {
    if (result.jobComplete) {
      rows.push(...namedRows(result));
      if (!result.pageToken) break;
    }
    if (!job?.jobId) throw new Error("BigQuery returned no job reference to read results from.");
    const params = new URLSearchParams({ timeoutMs: "60000", maxResults: "10000" });
    if (job.location) params.set("location", job.location);
    if (result.jobComplete && result.pageToken) params.set("pageToken", result.pageToken);
    const schema = result.schema;
    result = await requestJson<QueryResult>(
      fetchImpl,
      `${url}/${encodeURIComponent(job.jobId)}?${params}`,
      { method: "GET", headers },
      http,
    );
    // Later pages may leave the schema out.
    if (!result.schema && schema) result.schema = schema;
  }
  const all = googleCandidates(rows, { entries: opts.entries, category: opts.category, checkedAt: opts.checkedAt });
  // Keep at most `max` per advertiser, highest times shown first (the query's order).
  const perAdvertiser = new Map<string, number>();
  const candidates = all.filter((c) => {
    const n = perAdvertiser.get(c.advertiser.name) ?? 0;
    perAdvertiser.set(c.advertiser.name, n + 1);
    return n < opts.max;
  });
  return { candidates, fetched: rows.length, bytesProcessed: estimate };
}

export function googleCollectorFromEnv(env: LibraryEnv = process.env) {
  const creds = googleLibraryCredentials(env);
  return (opts: Omit<GoogleCollectOptions, "project" | "accessToken">) => collectGoogle({ ...opts, ...creds });
}
