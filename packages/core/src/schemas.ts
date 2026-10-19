import { z } from "zod";

/** A money value as LinkedIn expects it. */
export const MoneySchema = z.object({
  amount: z.string().describe("Decimal string, e.g. '100.00'"),
  currencyCode: z.string().length(3).default("USD"),
});

export const RunScheduleSchema = z.object({
  /** Epoch ms. */
  start: z.number().int().positive(),
  /** Epoch ms. Omit for an open-ended schedule. */
  end: z.number().int().positive().optional(),
});

export const CampaignGroupInputSchema = z.object({
  accountId: z.string().describe("Numeric ad account id (no urn prefix)"),
  name: z.string().min(1),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  totalBudget: MoneySchema.optional(),
  runSchedule: RunScheduleSchema.optional(),
});
export type CampaignGroupInput = z.infer<typeof CampaignGroupInputSchema>;

/** Supported campaign (ad group) formats we handle today. */
export const CampaignTypeSchema = z.enum([
  "SPONSORED_UPDATES",
  "TEXT_AD",
  "SPONSORED_INMAILS",
]);

/**
 * LinkedIn campaign objective. Use ENGAGEMENT to sponsor another member's post
 * (thought-leader ads, e.g. boosting a CEO's post) — LinkedIn requires the
 * objective be ENGAGEMENT for that ad format.
 */
export const ObjectiveTypeSchema = z.enum([
  "BRAND_AWARENESS",
  "ENGAGEMENT",
  "JOB_APPLICANT",
  "LEAD_GENERATION",
  "VIDEO_VIEW",
  "WEBSITE_CONVERSION",
  "WEBSITE_VISIT",
]);

/**
 * Structured targeting. Keys are short facet names (locations, seniorities,
 * titles, industries, staffCountRanges, skills, audienceMatchingSegments, ...);
 * values are entity URNs resolved via the search_targeting tool. URNs within a
 * facet are ORed; facets are ANDed; excluded facets are ORed.
 */
export const TargetingSpecSchema = z.object({
  include: z.record(z.array(z.string())).describe("facet short name -> entity URNs (ANDed across facets)"),
  exclude: z.record(z.array(z.string())).optional().describe("facet short name -> entity URNs to exclude"),
});
export type TargetingSpecInput = z.infer<typeof TargetingSpecSchema>;

/**
 * Ad rotation within a campaign (ad set). LinkedIn's default OPTIMIZED skews
 * impressions toward the ad it predicts will perform; ROUND_ROBIN is Campaign
 * Manager's "Rotate ads evenly". (The API enum is ROUND_ROBIN — there is no
 * ROTATE_EVENLY symbol.)
 */
export const CreativeSelectionSchema = z.enum(["OPTIMIZED", "ROUND_ROBIN"]);
export type CreativeSelection = z.infer<typeof CreativeSelectionSchema>;

/**
 * LinkedIn bidding strategy (Campaign Manager's "Bidding strategy"). MAX_CLICK is
 * Maximum Delivery optimized for landing page clicks: LinkedIn bids automatically,
 * charges per impression (costType CPM) and ignores unitCost. NONE is manual bidding.
 */
export const OptimizationTargetSchema = z.enum([
  "NONE",
  "MAX_CLICK",
  "MAX_IMPRESSION",
  "MAX_CONVERSION",
  "MAX_LEAD",
  "MAX_VIDEO_VIEW",
  "MAX_REACH",
  "TARGET_COST_PER_CLICK",
  "TARGET_COST_PER_IMPRESSION",
  "TARGET_COST_PER_VIDEO_VIEW",
  "ENHANCED_CONVERSION",
]);
export type OptimizationTarget = z.infer<typeof OptimizationTargetSchema>;

export const CampaignInputSchema = z.object({
  accountId: z.string(),
  campaignGroupId: z.string().describe("Numeric campaign group id"),
  name: z.string().min(1),
  type: CampaignTypeSchema.default("SPONSORED_UPDATES"),
  objectiveType: ObjectiveTypeSchema.optional().describe(
    "Campaign objective. Required to be ENGAGEMENT to sponsor another member's post (thought-leader ads).",
  ),
  costType: z.enum(["CPC", "CPM", "CPV"]).default("CPM"),
  dailyBudget: MoneySchema.optional(),
  totalBudget: MoneySchema.optional(),
  unitCost: MoneySchema.optional().describe("Bid amount"),
  optimizationTargetType: OptimizationTargetSchema.optional().describe(
    "Bidding strategy. MAX_CLICK = Maximum Delivery optimized for landing page clicks (automated bid, charged CPM, unitCost ignored). Omit or NONE for a manual bid.",
  ),
  locale: z.object({ country: z.string(), language: z.string() }).default({ country: "US", language: "en" }),
  runSchedule: RunScheduleSchema,
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).default("DRAFT"),
  creativeSelection: CreativeSelectionSchema.optional().describe(
    "Ad rotation: OPTIMIZED (LinkedIn default, favors the predicted winner) or ROUND_ROBIN (rotate ads evenly)",
  ),
  /**
   * Raw targetingCriteria object (include/exclude tree). Build with helpers in
   * targeting.ts, or pass an adSegment urn via `audienceSegmentUrn` for convenience.
   */
  targetingCriteria: z.record(z.any()).optional(),
  /** Preferred: structured targeting (facets + entities). Built into targetingCriteria. */
  targeting: TargetingSpecSchema.optional(),
  audienceSegmentUrn: z.string().optional().describe("urn:li:adSegment:... to target a matched audience"),
  geoUrns: z.array(z.string()).optional().describe("urn:li:geo:... locations to include"),
  /** Political-ad self-declaration, mandatory for EU targeting. Defaults to not political. */
  politicalIntent: z.enum(["NOT_POLITICAL", "POLITICAL", "NOT_DECLARED"]).default("NOT_POLITICAL"),
  /** Existing conversion ids to associate (select an insight-tag conversion to track). */
  conversionIds: z.array(z.string()).optional(),
  /** Apply the standing default audience exclusions (live customers, competitors, exclude list). Set false to skip. */
  applyDefaultExclusions: z.boolean().default(true),
  /** When no conversionIds are given, attach the account's default conversion. Set false to skip. */
  applyDefaultConversion: z.boolean().default(true),
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

/**
 * Patch an existing campaign ("ad group"). Every field is optional: only the
 * ones provided are changed (LinkedIn PARTIAL_UPDATE). Targeting is replaced
 * wholesale when any targeting form is given — pass a structured `targeting`
 * spec, the `audienceSegmentUrn` (+ optional `geoUrns`) shorthand, or a raw
 * `targetingCriteria`. Leave all three unset to keep the current targeting.
 */
export const CampaignUpdateSchema = z.object({
  accountId: z.string(),
  campaignId: z.string().describe("Numeric campaign (ad group) id to update"),
  /** Raw targetingCriteria tree (replaces existing). Prefer `targeting`/`audienceSegmentUrn`. */
  targetingCriteria: z.record(z.any()).optional(),
  /** Structured targeting (facets + entity URNs). Replaces existing targeting. */
  targeting: TargetingSpecSchema.optional(),
  audienceSegmentUrn: z
    .string()
    .optional()
    .describe("urn:li:adSegment:... (or bare id) matched audience to target, which replaces existing targeting"),
  geoUrns: z.array(z.string()).optional().describe("urn:li:geo:... locations to include alongside the audience"),
  /** When replacing targeting, merge the standing default exclusions in. Set false to skip. */
  applyDefaultExclusions: z.boolean().default(true),
  /** Other patchable fields (each left unchanged when omitted). */
  name: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  dailyBudget: MoneySchema.optional(),
  totalBudget: MoneySchema.optional(),
  costType: z.enum(["CPC", "CPM", "CPV"]).optional().describe("Change the cost type (CPM for Maximum Delivery)"),
  unitCost: MoneySchema.optional().describe("Bid amount"),
  optimizationTargetType: OptimizationTargetSchema.optional().describe(
    "Bidding strategy. MAX_CLICK = Maximum Delivery optimized for landing page clicks (automated bid, charged CPM, unitCost ignored). Omit or NONE for a manual bid.",
  ),
  runSchedule: RunScheduleSchema.optional(),
  creativeSelection: CreativeSelectionSchema.optional().describe(
    "Ad rotation: OPTIMIZED (favors the predicted winner) or ROUND_ROBIN (rotate ads evenly)",
  ),
  /** Build and return the patch WITHOUT sending it. Preview before touching a live campaign. */
  dryRun: z.boolean().default(false),
});
export type CampaignUpdateInput = z.infer<typeof CampaignUpdateSchema>;

export const TextAdCreativeSchema = z.object({
  accountId: z.string(),
  campaignId: z.string(),
  title: z.string().max(25),
  text: z.string().max(75),
  clickUri: z.string().url(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).default("DRAFT"),
});
export type TextAdCreativeInput = z.infer<typeof TextAdCreativeSchema>;

export const SponsoredImageCreativeSchema = z.object({
  accountId: z.string(),
  campaignId: z.string(),
  organizationUrn: z.string().describe("urn:li:organization:... that owns the post"),
  commentary: z.string().describe("The post body / ad intro text"),
  clickUri: z.string().url(),
  headline: z.string(),
  callToAction: z
    .enum(["LEARN_MORE", "APPLY", "DOWNLOAD", "VIEW_QUOTE", "SIGN_UP", "SUBSCRIBE", "REGISTER", "JOIN", "ATTEND", "REQUEST_DEMO", "SEE_MORE"])
    .default("LEARN_MORE")
    .describe("Call-to-action button label"),
  /** Local path to the image to upload. Omit to leave a copy-only draft for later. */
  imagePath: z.string().optional(),
  name: z.string().optional().describe("Ad name shown in Campaign Manager"),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]).default("DRAFT"),
});
export type SponsoredImageCreativeInput = z.infer<typeof SponsoredImageCreativeSchema>;

/**
 * The statuses an existing ad (creative) can be switched to. PAUSED stops it
 * serving, ACTIVE starts it serving and spending, ARCHIVED retires it. DRAFT is
 * left out on purpose: Adwarp creates ads as drafts, and this only pauses,
 * resumes, or archives them.
 */
export const AdStatusSchema = z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]);
export type AdStatus = z.infer<typeof AdStatusSchema>;

/**
 * Change an existing ad (creative) in place via LinkedIn PARTIAL_UPDATE of its
 * `intendedStatus`. `status` is required and has no default, so no call can
 * switch an ad on by omission.
 */
export const AdUpdateSchema = z.object({
  accountId: z.string().optional().describe("Numeric ad account id; defaults to the configured account"),
  creativeId: z.string().describe("Numeric creative (ad) id or a full urn:li:sponsoredCreative URN"),
  status: AdStatusSchema.describe(
    "PAUSED stops the ad serving. ACTIVE starts it serving and spending: set it only when the user explicitly asks. ARCHIVED retires it.",
  ),
  dryRun: z.boolean().default(false).describe("Return the patch without sending it"),
});
export type AdUpdateInput = z.infer<typeof AdUpdateSchema>;

export const AudienceUploadSchema = z.object({
  accountId: z.string(),
  name: z.string().min(1),
  csvPath: z.string(),
  /** Column header holding the email address. */
  emailColumn: z.string().default("email"),
  description: z.string().optional(),
});
export type AudienceUploadInput = z.infer<typeof AudienceUploadSchema>;

export const ReportPeriodSchema = z.enum([
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "month_to_date",
  "last_month",
]);
export const ReportLevelSchema = z.enum(["account", "campaign_group", "campaign", "creative"]);

const dateWindow = {
  period: ReportPeriodSchema.default("last_30_days"),
  startDate: z.string().optional().describe("YYYY-MM-DD; with endDate, overrides period"),
  endDate: z.string().optional().describe("YYYY-MM-DD"),
};

export const PerformanceQuerySchema = z.object({
  accountId: z.string().optional(),
  level: ReportLevelSchema.default("campaign_group").describe("campaign_group=campaign, campaign=ad group, creative=ad"),
  parentId: z.string().optional().describe("Parent group id (for level=campaign) or campaign id (for level=creative)"),
  ...dateWindow,
});
export type PerformanceQueryInput = z.infer<typeof PerformanceQuerySchema>;

export const SummaryQuerySchema = z.object({ accountId: z.string().optional(), ...dateWindow });
export type SummaryQueryInput = z.infer<typeof SummaryQuerySchema>;

export const TrendQuerySchema = z.object({
  level: ReportLevelSchema.default("campaign"),
  entityId: z.string().describe("Numeric id of the account/group/campaign/creative to trend"),
  bucket: z.enum(["weekly", "monthly"]).default("weekly"),
  ...dateWindow,
  period: ReportPeriodSchema.default("last_90_days"),
});
export type TrendQueryInput = z.infer<typeof TrendQuerySchema>;

export const SalesforceAudienceSchema = z.object({
  accountId: z.string(),
  name: z.string().min(1).describe("Audience/segment name"),
  soql: z.string().describe("SOQL selecting an email column, e.g. SELECT Email FROM Contact WHERE ..."),
  emailField: z.string().optional().describe("Email column name if not 'Email'"),
});
export type SalesforceAudienceInput = z.infer<typeof SalesforceAudienceSchema>;

/** HubSpot CRM search operators, as HubSpot's search API names them. */
export const HubSpotFilterOperatorSchema = z.enum([
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "HAS_PROPERTY",
  "NOT_HAS_PROPERTY",
  "CONTAINS_TOKEN",
  "NOT_CONTAINS_TOKEN",
]);

export const HubSpotFilterSchema = z.object({
  property: z.string().min(1).describe("HubSpot property internal name, e.g. lifecyclestage"),
  operator: HubSpotFilterOperatorSchema,
  value: z
    .string()
    .optional()
    .describe("Value to compare. IN and NOT_IN take a comma-separated list, BETWEEN takes 'low,high', HAS_PROPERTY and NOT_HAS_PROPERTY take none."),
});
export type HubSpotFilter = z.infer<typeof HubSpotFilterSchema>;

export const HubSpotAudienceSchema = z.object({
  accountId: z.string().optional().describe("LinkedIn ad account id; defaults to config defaultAccountId"),
  name: z.string().min(1).describe("Audience/segment name"),
  type: z
    .enum(["contact", "company"])
    .optional()
    .describe("contact or company. With listId it defaults to the list's object type; with filters it defaults to contact."),
  listId: z
    .string()
    .regex(/^\d+$/, "listId is the numeric HubSpot list id")
    .optional()
    .describe("HubSpot list id (the ILS list id). Pass this or filters, not both."),
  filters: z
    .array(HubSpotFilterSchema)
    .min(1)
    .max(6)
    .optional()
    .describe("CRM search filters, all ANDed (HubSpot allows up to 6 per group). Pass this or listId, not both."),
  dryRun: z.boolean().default(false).describe("Return counts and a masked sample without uploading anything"),
});
export type HubSpotAudienceInput = z.infer<typeof HubSpotAudienceSchema>;

export const AdLibraryScanSchema = z.object({
  advertiser: z.string().optional().describe("Competitor/advertiser display name (accountOwner)"),
  companyId: z.string().optional().describe("Numeric LinkedIn company id, more precise than name"),
  keyword: z.string().optional().describe("Free-text keyword search across ad copy"),
  countries: z.array(z.string()).optional().describe("ISO-3166 country codes to scope, e.g. ['US','GB']"),
  max: z.number().int().positive().max(500).default(50).describe("Max ads to collect"),
  engine: z.enum(["auto", "api"]).default("auto").describe("auto = official API plus remote creative worker; api = metadata only. Local scraping is disabled."),
  deep: z.boolean().default(true).describe("Enqueue up to 10 verified company ads on the remote worker; reuse cached creatives."),
  concurrency: z.literal(1).default(1).describe("Remote worker concurrency is fixed at one."),
  copyMax: z.number().int().nonnegative().max(10).default(10).describe("Creative sample size, capped at 10. Worker budgets cannot be overridden."),
});
export type AdLibraryScanInput = z.infer<typeof AdLibraryScanSchema>;

export const LaunchFromBriefSchema = z.object({
  accountId: z.string(),
  campaignGroupName: z.string(),
  campaignName: z.string(),
  audience: AudienceUploadSchema.omit({ accountId: true }).optional(),
  dailyBudget: MoneySchema,
  bid: MoneySchema.optional(),
  type: CampaignTypeSchema.default("SPONSORED_UPDATES"),
  runSchedule: RunScheduleSchema,
  geoUrns: z.array(z.string()).default(["urn:li:geo:103644278"]).describe("Defaults to United States"),
  /** Optional structured targeting (titles, seniority, industry, etc.) merged with geo. */
  targeting: TargetingSpecSchema.optional(),
  /** Existing conversion ids to associate with the campaign. */
  conversionIds: z.array(z.string()).optional(),
  /** Or select an existing conversion by name (resolved to its id). */
  conversionName: z.string().optional().describe("e.g. 'Demo Booked - Insight Tag'"),
  /** Ad rotation for the campaign. Omit for LinkedIn's default (OPTIMIZED). */
  creativeSelection: CreativeSelectionSchema.optional(),
  creatives: z.array(z.union([TextAdCreativeSchema.omit({ accountId: true, campaignId: true }), SponsoredImageCreativeSchema.omit({ accountId: true, campaignId: true })])).optional(),
});
export type LaunchFromBriefInput = z.infer<typeof LaunchFromBriefSchema>;
