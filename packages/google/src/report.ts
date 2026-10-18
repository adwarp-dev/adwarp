import {
  deriveCoreKpis,
  resolveIsoDateRange,
  topBy,
  bottomBy,
  num,
  r2,
  type IsoDateRange,
  type Period,
} from "@adwarp/shared";
import type { GoogleAdsClient } from "./http.js";
import { search, dateClause } from "./gaql.js";
import { fromMicros } from "./mutate.js";
import type { GoogleReportLevel } from "./schemas.js";

export type { Period };
export { topBy, bottomBy };

/**
 * A performance row. `cost` is in the ad account's currency, which is fixed at
 * account creation and is not necessarily USD, so it is deliberately not named
 * costUsd the way LinkedIn's is.
 */
export interface GoogleMetricRow {
  entityId: string;
  name: string;
  /** Campaign (or campaign > ad group) the row sits under. */
  parent?: string;
  status?: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversionsValue: number;
  /** Ratios (0-1). */
  ctr: number;
  cvr: number;
  /** Account currency. */
  cpc: number;
  cpm: number;
  costPerConversion: number;
}

/** The resource, id field, and label each report level reads from. */
const LEVEL_QUERY: Record<GoogleReportLevel, { from: string; select: string; idOf: (r: any) => string; nameOf: (r: any) => string; parentOf: (r: any) => string | undefined; statusOf?: (r: any) => string | undefined }> = {
  campaign: {
    from: "campaign",
    select: "campaign.id, campaign.name, campaign.status",
    idOf: (r) => String(r.campaign?.id ?? ""),
    nameOf: (r) => r.campaign?.name ?? "",
    parentOf: () => undefined,
    statusOf: (r) => r.campaign?.status,
  },
  ad_group: {
    from: "ad_group",
    select: "ad_group.id, ad_group.name, ad_group.status, campaign.name",
    idOf: (r) => String(r.adGroup?.id ?? ""),
    nameOf: (r) => r.adGroup?.name ?? "",
    parentOf: (r) => r.campaign?.name,
    statusOf: (r) => r.adGroup?.status,
  },
  ad: {
    from: "ad_group_ad",
    select:
      "ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.responsive_search_ad.headlines, ad_group.name, campaign.name",
    idOf: (r) => String(r.adGroupAd?.ad?.id ?? ""),
    // An RSA has no name, so the first headline is the only human handle it has.
    nameOf: (r) => r.adGroupAd?.ad?.responsiveSearchAd?.headlines?.[0]?.text ?? `ad ${r.adGroupAd?.ad?.id ?? ""}`,
    parentOf: (r) => [r.campaign?.name, r.adGroup?.name].filter(Boolean).join(" > "),
    statusOf: (r) => r.adGroupAd?.status,
  },
  keyword: {
    from: "keyword_view",
    select:
      "ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.name, campaign.name",
    idOf: (r) => String(r.adGroupCriterion?.criterionId ?? ""),
    nameOf: (r) =>
      `${r.adGroupCriterion?.keyword?.text ?? ""} [${r.adGroupCriterion?.keyword?.matchType ?? ""}]`,
    parentOf: (r) => [r.campaign?.name, r.adGroup?.name].filter(Boolean).join(" > "),
    statusOf: (r) => r.adGroupCriterion?.status,
  },
  search_term: {
    from: "search_term_view",
    select: "search_term_view.search_term, search_term_view.status, ad_group.name, campaign.name",
    idOf: (r) => r.searchTermView?.searchTerm ?? "",
    nameOf: (r) => r.searchTermView?.searchTerm ?? "",
    parentOf: (r) => [r.campaign?.name, r.adGroup?.name].filter(Boolean).join(" > "),
    statusOf: (r) => r.searchTermView?.status,
  },
};

const METRICS = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";

function toRow(r: any, spec: (typeof LEVEL_QUERY)[GoogleReportLevel]): GoogleMetricRow {
  const m = r.metrics ?? {};
  const base = {
    impressions: num(m.impressions),
    clicks: num(m.clicks),
    // cost_micros is an int64, so it arrives as a string. Never divide it raw.
    costUsd: fromMicros(m.costMicros ?? 0),
    conversions: num(m.conversions),
  };
  return {
    entityId: spec.idOf(r),
    name: spec.nameOf(r),
    parent: spec.parentOf(r) || undefined,
    status: spec.statusOf?.(r),
    impressions: base.impressions,
    clicks: base.clicks,
    cost: base.costUsd,
    conversions: base.conversions,
    conversionsValue: r2(num(m.conversionsValue)),
    ...deriveCoreKpis(base),
  };
}

/** Per-entity performance at a level, over a date range, sorted by spend. */
export async function getGooglePerformance(
  client: GoogleAdsClient,
  customerId: string,
  opts: { level: GoogleReportLevel; dateRange: IsoDateRange; campaignId?: string },
): Promise<GoogleMetricRow[]> {
  const spec = LEVEL_QUERY[opts.level];
  const filters: string[] = [];
  if (opts.campaignId) filters.push(`campaign.id = ${Number(opts.campaignId)}`);
  // A row with no impressions in the window is noise in every one of these reports.
  filters.push("metrics.impressions > 0");

  const where = `WHERE ${filters.join(" AND ")}${dateClause(opts.dateRange)}`;
  const rows = await search(
    client,
    customerId,
    `SELECT ${spec.select}, ${METRICS} FROM ${spec.from} ${where}`,
  );

  // Google returns one row per entity per day when segments.date is in the
  // filter, so identical entities have to be summed back together.
  const merged = new Map<string, GoogleMetricRow>();
  for (const raw of rows) {
    const row = toRow(raw, spec);
    const existing = merged.get(row.entityId);
    if (!existing) {
      merged.set(row.entityId, row);
      continue;
    }
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.cost = r2(existing.cost + row.cost);
    existing.conversions += row.conversions;
    existing.conversionsValue = r2(existing.conversionsValue + row.conversionsValue);
  }

  const out = [...merged.values()].map((row) => ({
    ...row,
    ...deriveCoreKpis({
      impressions: row.impressions,
      clicks: row.clicks,
      costUsd: row.cost,
      conversions: row.conversions,
    }),
  }));
  return out.sort((a, b) => b.cost - a.cost);
}

/** Sum rows and recompute KPIs from the totals. */
export function aggregateGoogle(rows: GoogleMetricRow[], label = "(total)"): GoogleMetricRow {
  const base = { impressions: 0, clicks: 0, costUsd: 0, conversions: 0 };
  let conversionsValue = 0;
  for (const r of rows) {
    base.impressions += r.impressions;
    base.clicks += r.clicks;
    base.costUsd += r.cost;
    base.conversions += r.conversions;
    conversionsValue += r.conversionsValue;
  }
  base.costUsd = r2(base.costUsd);
  return {
    entityId: "",
    name: label,
    impressions: base.impressions,
    clicks: base.clicks,
    cost: base.costUsd,
    conversions: base.conversions,
    conversionsValue: r2(conversionsValue),
    ...deriveCoreKpis(base),
  };
}

/** Resolve a named period or explicit start/end into a date range. */
export function resolveGoogleDateRange(opts: { period?: Period; startDate?: string; endDate?: string }): IsoDateRange {
  return resolveIsoDateRange(opts);
}
