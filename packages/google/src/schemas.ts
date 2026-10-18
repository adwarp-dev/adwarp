import { z } from "zod";

/**
 * Zod schemas are the source of truth for every Google Ads input, reused
 * verbatim as MCP tool input schemas so the CLI and MCP can never drift.
 *
 * The safety rule lives here, in the type system: there is no status field on
 * any create schema that can express ENABLED. Campaigns, ad groups, and ads are
 * created PAUSED and can only be switched on by a human in the Google Ads UI,
 * which is the same guarantee Adwarp gives on LinkedIn with DRAFT.
 */

/* -------------------------------- primitives -------------------------------- */

/**
 * Money in the ad account's own currency, as a decimal number of whole units.
 * Google has no per-campaign currency: the account's currency is fixed at
 * creation and every amount is denominated in it.
 */
export const AmountSchema = z
  .number()
  .positive()
  .describe("Amount in the ad account's currency, e.g. 150 for $150");

export const MatchTypeSchema = z
  .enum(["EXACT", "PHRASE", "BROAD"])
  .describe("EXACT and PHRASE keep B2B spend tight; BROAD needs strong negatives");

export const KeywordSchema = z.object({
  text: z.string().min(1),
  matchType: MatchTypeSchema.default("PHRASE"),
});
export type KeywordInput = z.infer<typeof KeywordSchema>;

/**
 * A responsive search ad. Google's own minimums are enforced here so a bad ad
 * is rejected before it costs an API round trip: at least 3 headlines (30 chars
 * each) and 2 descriptions (90 chars each).
 */
export const ResponsiveSearchAdSchema = z.object({
  headlines: z.array(z.string().min(1).max(30)).min(3).max(15).describe("3-15 headlines, 30 chars each"),
  descriptions: z.array(z.string().min(1).max(90)).min(2).max(4).describe("2-4 descriptions, 90 chars each"),
  /** Falls back to the campaign-level finalUrl when omitted. */
  finalUrl: z.string().url().optional(),
  path1: z.string().max(15).optional().describe("First display-URL path segment"),
  path2: z
    .string()
    .max(15)
    .optional()
    .describe("Second display-URL path segment. Requires path1: Google rejects path2 on its own."),
}).refine((ad) => !ad.path2 || !!ad.path1, {
  message: "path2 requires path1 (Google: VALUE_MUST_BE_UNSET on responsive_search_ad.path2)",
  path: ["path2"],
});
export type ResponsiveSearchAdInput = z.infer<typeof ResponsiveSearchAdSchema>;

export const AdGroupBriefSchema = z.object({
  name: z.string().min(1),
  /** Default max CPC for the ad group. Falls back to the campaign-level bid. */
  cpcBid: AmountSchema.optional(),
  keywords: z.array(KeywordSchema).min(1),
  negativeKeywords: z.array(KeywordSchema).optional(),
  ads: z.array(ResponsiveSearchAdSchema).min(1),
});
export type AdGroupBriefInput = z.infer<typeof AdGroupBriefSchema>;

/* ------------------------------ campaign brief ------------------------------ */

export const SearchCampaignBriefSchema = z.object({
  customerId: z.string().optional().describe("10-digit customer id; falls back to config default"),
  campaignName: z.string().min(1),
  /** Daily budget. Required: no campaign is created without a stated cap. */
  dailyBudget: AmountSchema,
  budgetName: z.string().optional().describe("Defaults to the campaign name"),
  /** Default max CPC applied to ad groups that do not set their own. */
  cpcBid: AmountSchema.optional(),
  finalUrl: z.string().url().describe("Landing page for ads that do not override it"),
  locations: z
    .array(z.string())
    .default(["US"])
    .describe("ISO country codes (US, GB) or raw geoTargetConstant ids"),
  languages: z.array(z.string()).default(["en"]).describe("ISO language codes"),
  adGroups: z.array(AdGroupBriefSchema).min(1),
  /** Campaign-level negatives, on top of anything set per ad group. */
  negativeKeywords: z.array(KeywordSchema).optional(),
  /** Existing shared negative-keyword list to attach. Not applied by default. */
  negativeKeywordListId: z.string().optional(),
  conversionActionNames: z
    .array(z.string())
    .optional()
    .describe("Conversion actions to set as this campaign's goals; falls back to the config default"),
  /** "YYYY-MM-DD HH:MM:SS". Omitted means the campaign starts today (paused, so it does not serve). */
  startDateTime: z.string().optional(),
  endDateTime: z.string().optional(),
  /**
   * Server-side validation without persisting anything. Defaults to true: the
   * dry run is the default, and creating for real is the explicit choice.
   */
  validateOnly: z.boolean().default(true),
});
export type SearchCampaignBriefInput = z.infer<typeof SearchCampaignBriefSchema>;

/* --------------------------------- queries ---------------------------------- */

export const KeywordIdeasSchema = z.object({
  customerId: z.string().optional(),
  seeds: z.array(z.string().min(1)).min(1).describe("Seed keywords or phrases"),
  /** Landing page to mine for ideas alongside the seeds. */
  pageUrl: z.string().url().optional(),
  locations: z.array(z.string()).default(["US"]),
  languages: z.array(z.string()).default(["en"]),
  limit: z.number().int().positive().max(200).default(50),
});
export type KeywordIdeasInput = z.infer<typeof KeywordIdeasSchema>;

export const GoogleReportLevelSchema = z.enum(["campaign", "ad_group", "ad", "keyword", "search_term"]);
export type GoogleReportLevel = z.infer<typeof GoogleReportLevelSchema>;

export const PeriodSchema = z.enum([
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "month_to_date",
  "last_month",
]);

export const GooglePerformanceSchema = z.object({
  customerId: z.string().optional(),
  level: GoogleReportLevelSchema.default("campaign"),
  period: PeriodSchema.optional(),
  startDate: z.string().optional().describe("YYYY-MM-DD"),
  endDate: z.string().optional().describe("YYYY-MM-DD"),
  /** Restrict to one campaign (by numeric id) when reading a level below campaign. */
  campaignId: z.string().optional(),
});
export type GooglePerformanceInput = z.infer<typeof GooglePerformanceSchema>;

export const GoogleSearchSchema = z.object({
  customerId: z.string().optional(),
  query: z.string().min(1).describe("A GAQL query. Read-only: SELECT ... FROM ..."),
});
export type GoogleSearchInput = z.infer<typeof GoogleSearchSchema>;

export const ListGoogleCampaignsSchema = z.object({
  customerId: z.string().optional(),
  /** Include REMOVED campaigns, which are hidden by default. */
  includeRemoved: z.boolean().default(false),
});
export type ListGoogleCampaignsInput = z.infer<typeof ListGoogleCampaignsSchema>;
