import {
  deriveCoreKpis,
  resolvePeriodIso,
  resolveIsoDateRange,
  num,
  r2,
  r4,
  pctChange,
  topBy,
  bottomBy,
  type Period,
} from "@adwarp/shared";
import type { LinkedInClient } from "./http.js";
import {
  fetchAnalytics,
  type AnalyticsPivot,
  type DateRange,
  type LiDate,
  type RawAnalyticsRow,
} from "./resources/analytics.js";
import { getCampaign } from "./resources/campaigns.js";
import { getCampaignGroup } from "./resources/campaignGroups.js";

/* ----------------------------------- dates ---------------------------------- */

// The period math is shared; only the conversion into LinkedIn's `{year, month,
// day}` date shape is LinkedIn's.
export type { Period };
export { topBy, bottomBy };

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Parse "YYYY-MM-DD" into a LiDate. */
export function parseDate(s: string): LiDate {
  const [year, month, day] = s.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Resolve a named period into a concrete date range, relative to `now`. */
export function resolvePeriod(period: Period, now = new Date()): DateRange {
  const { start, end } = resolvePeriodIso(period, now);
  return { start: parseDate(start), end: parseDate(end) };
}

/** Resolve a date range from an explicit start/end (YYYY-MM-DD) or a named period. */
export function resolveDateRange(opts: { period?: Period; startDate?: string; endDate?: string }): DateRange {
  const { start, end } = resolveIsoDateRange(opts);
  return { start: parseDate(start), end: parseDate(end) };
}

/* --------------------------------- metrics ---------------------------------- */

export interface MetricRow {
  entityUrn: string;
  entityId: string;
  name?: string;
  impressions: number;
  clicks: number;
  costUsd: number;
  conversions: number;
  leads: number;
  landingPageClicks: number;
  engagements: number;
  videoViews: number;
  /** Derived KPIs. ctr/cvr/engagementRate are ratios (0-1). */
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number;
  cvr: number;
  costPerConversion: number;
  engagementRate: number;
  dateRange?: DateRange;
}

interface BaseMetrics {
  impressions: number;
  clicks: number;
  costUsd: number;
  conversions: number;
  leads: number;
  landingPageClicks: number;
  engagements: number;
  videoViews: number;
}
interface Kpis {
  ctr: number;
  cpc: number;
  cpm: number;
  cpl: number;
  cvr: number;
  costPerConversion: number;
  engagementRate: number;
}

/** The universal KPIs plus the two LinkedIn adds on top (cost per lead, engagement rate). */
function deriveKpis(base: BaseMetrics): Kpis {
  const { impressions, costUsd, leads, engagements } = base;
  return {
    ...deriveCoreKpis(base),
    cpl: leads ? r2(costUsd / leads) : 0,
    engagementRate: impressions ? r4(engagements / impressions) : 0,
  };
}

function rawToBase(raw: RawAnalyticsRow) {
  return {
    impressions: num(raw.impressions),
    clicks: num(raw.clicks),
    costUsd: r2(num(raw.costInUsd)),
    conversions: num(raw.externalWebsiteConversions),
    leads: num(raw.oneClickLeads) + num(raw.qualifiedLeads),
    landingPageClicks: num(raw.landingPageClicks),
    engagements: num(raw.totalEngagements),
    videoViews: num(raw.videoViews),
  };
}

/** Normalize a raw analytics row into a MetricRow with derived KPIs. */
export function normalize(raw: RawAnalyticsRow): MetricRow {
  const base = rawToBase(raw);
  const urn = raw.pivotValues?.[0] ?? "";
  return {
    entityUrn: urn,
    entityId: urn.split(":").pop() ?? "",
    ...base,
    ...deriveKpis(base),
    dateRange: raw.dateRange,
  };
}

/** Sum a set of rows and recompute KPIs from the totals. */
export function aggregate(rows: MetricRow[], label = "(total)"): MetricRow {
  const base = {
    impressions: 0, clicks: 0, costUsd: 0, conversions: 0, leads: 0,
    landingPageClicks: 0, engagements: 0, videoViews: 0,
  };
  for (const r of rows) {
    base.impressions += r.impressions; base.clicks += r.clicks; base.costUsd += r.costUsd;
    base.conversions += r.conversions; base.leads += r.leads; base.landingPageClicks += r.landingPageClicks;
    base.engagements += r.engagements; base.videoViews += r.videoViews;
  }
  base.costUsd = r2(base.costUsd);
  return { entityUrn: "", entityId: "", name: label, ...base, ...deriveKpis(base) };
}

/* ----------------------------- ranking & flags ------------------------------ */

export interface Flag {
  entityUrn: string;
  name?: string;
  kind: "spend_no_conversions" | "high_cpc" | "low_ctr";
  detail: string;
}

/** Heuristic flags vs the account average. */
export function flagRows(rows: MetricRow[], totals: MetricRow): Flag[] {
  const flags: Flag[] = [];
  for (const r of rows) {
    if (r.costUsd >= 50 && r.conversions === 0) {
      flags.push({ entityUrn: r.entityUrn, name: r.name, kind: "spend_no_conversions", detail: `$${r.costUsd} spent, 0 conversions` });
    }
    if (totals.cpc > 0 && r.clicks >= 20 && r.cpc > totals.cpc * 2.5) {
      flags.push({ entityUrn: r.entityUrn, name: r.name, kind: "high_cpc", detail: `CPC $${r.cpc} vs account avg $${totals.cpc}` });
    }
    if (totals.ctr > 0 && r.impressions >= 1000 && r.ctr < totals.ctr * 0.4) {
      flags.push({ entityUrn: r.entityUrn, name: r.name, kind: "low_ctr", detail: `CTR ${(r.ctr * 100).toFixed(2)}% vs account avg ${(totals.ctr * 100).toFixed(2)}%` });
    }
  }
  return flags;
}

/* ------------------------------- name lookup -------------------------------- */

export type ReportLevel = "account" | "campaign_group" | "campaign" | "creative";
const PIVOT: Record<ReportLevel, AnalyticsPivot> = {
  account: "ACCOUNT",
  campaign_group: "CAMPAIGN_GROUP",
  campaign: "CAMPAIGN",
  creative: "CREATIVE",
};

/** Best-effort: fill in human names for campaign/group rows (capped concurrency). */
async function resolveNames(client: LinkedInClient, accountId: string, level: ReportLevel, rows: MetricRow[]) {
  if (level !== "campaign" && level !== "campaign_group") return;
  const get = level === "campaign" ? getCampaign : getCampaignGroup;
  await Promise.all(
    rows.slice(0, 60).map(async (r) => {
      try {
        const e = (await get(client, accountId, r.entityId)) as { name?: string };
        if (e?.name) r.name = e.name;
      } catch {
        /* leave name unset */
      }
    }),
  );
}

/* ------------------------------ public reports ------------------------------ */

/**
 * Per-entity performance at a level, under an account (or a parent campaign
 * group / campaign), over a date range. Rows carry derived KPIs and names.
 */
export async function getPerformance(
  client: LinkedInClient,
  opts: { accountId: string; level: ReportLevel; dateRange: DateRange; parentId?: string },
): Promise<MetricRow[]> {
  const { accountId, level, dateRange, parentId } = opts;
  let filterType: "accounts" | "campaignGroups" | "campaigns" = "accounts";
  let ids = [accountId];
  if (parentId && level === "campaign") { filterType = "campaignGroups"; ids = [parentId]; }
  if (parentId && level === "creative") { filterType = "campaigns"; ids = [parentId]; }

  const raw = await fetchAnalytics(client, {
    pivot: PIVOT[level],
    timeGranularity: "ALL",
    dateRange,
    filterType,
    ids,
  });
  const rows = raw.map(normalize).sort((a, b) => b.costUsd - a.costUsd);
  await resolveNames(client, accountId, level, rows);
  return rows;
}

export interface PerformanceSummary {
  dateRange: DateRange;
  totals: MetricRow;
  groups: MetricRow[];
  topBySpend: MetricRow[];
  topByCtr: MetricRow[];
  worstByCpl: MetricRow[];
  flags: Flag[];
}

/** Account-level rollup with top/bottom performers and flags. */
export async function performanceSummary(
  client: LinkedInClient,
  opts: { accountId: string; dateRange: DateRange },
): Promise<PerformanceSummary> {
  const groups = await getPerformance(client, { accountId: opts.accountId, level: "campaign_group", dateRange: opts.dateRange });
  const totals = aggregate(groups);
  const withConversions = groups.filter((g) => g.conversions > 0);
  return {
    dateRange: opts.dateRange,
    totals,
    groups,
    topBySpend: topBy(groups, "costUsd", 5),
    topByCtr: topBy(groups.filter((g) => g.impressions >= 1000), "ctr", 5),
    worstByCpl: topBy(withConversions, "costPerConversion", 5),
    flags: flagRows(groups, totals),
  };
}

export interface TrendPoint extends MetricRow {
  periodStart: string;
  deltas?: Record<string, number>;
}

const isoWeekStart = (d: LiDate): string => {
  const dt = utc(d.year, d.month - 1, d.day);
  const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
  dt.setUTCDate(dt.getUTCDate() - dow);
  return dt.toISOString().slice(0, 10);
};

const pct = pctChange;

/**
 * Weekly or monthly trend for one entity, with period-over-period deltas on the
 * headline metrics. Weekly is computed by bucketing daily data (LinkedIn has no
 * native weekly granularity).
 */
export async function performanceTrend(
  client: LinkedInClient,
  opts: { level: ReportLevel; entityId: string; dateRange: DateRange; bucket: "weekly" | "monthly" },
): Promise<TrendPoint[]> {
  const filterType = ({ account: "accounts", campaign_group: "campaignGroups", campaign: "campaigns", creative: "creatives" } as const)[opts.level];
  const raw = await fetchAnalytics(client, {
    pivot: PIVOT[opts.level],
    timeGranularity: opts.bucket === "monthly" ? "MONTHLY" : "DAILY",
    dateRange: opts.dateRange,
    filterType,
    ids: [opts.entityId],
  });

  let points: TrendPoint[];
  if (opts.bucket === "monthly") {
    points = raw
      .map(normalize)
      .map((r) => ({ ...r, periodStart: `${r.dateRange!.start.year}-${String(r.dateRange!.start.month).padStart(2, "0")}` }))
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  } else {
    const buckets = new Map<string, MetricRow[]>();
    for (const row of raw.map(normalize)) {
      const key = isoWeekStart(row.dateRange!.start);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(row);
    }
    points = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, rows]) => ({ ...aggregate(rows), periodStart }));
  }

  for (let i = 1; i < points.length; i++) {
    const c = points[i]!;
    const p = points[i - 1]!;
    c.deltas = {
      impressions: pct(c.impressions, p.impressions),
      clicks: pct(c.clicks, p.clicks),
      costUsd: pct(c.costUsd, p.costUsd),
      conversions: pct(c.conversions, p.conversions),
      ctr: pct(c.ctr, p.ctr),
    };
  }
  return points;
}
