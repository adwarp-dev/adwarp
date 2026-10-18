import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createGoogleAds,
  listAccessibleCustomers,
  listClientAccounts,
  listCampaigns,
  listAds,
  listConversionActions,
  generateKeywordIdeas,
  launchSearchCampaign,
  getGooglePerformance,
  aggregateGoogle,
  resolveGoogleDateRange,
  requireCustomerId,
  search as gaqlSearch,
  SearchCampaignBriefSchema,
  KeywordIdeasSchema,
  GooglePerformanceSchema,
  GoogleSearchSchema,
  ListGoogleCampaignsSchema,
} from "@adwarp/google";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

/**
 * Google Ads tools, named `gads_*` so nothing collides with the LinkedIn tools
 * on the same server.
 *
 * Every tool here is read-only except `gads_launch_search_campaign`, and that
 * one defaults to a validate-only dry run. Nothing in this surface can enable a
 * campaign, an ad group, or an ad.
 */
export function registerGoogleTools(server: McpServer): void {
  server.tool(
    "gads_list_accounts",
    "List every Google Ads customer this login can reach. Run this first: it proves the OAuth client, developer token, and account access all work.",
    {},
    async () => {
      try {
        const googleAds = await createGoogleAds();
        return ok(await listAccessibleCustomers(googleAds.client));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_list_client_accounts",
    "List the client accounts under a Google Ads manager (MCC) account.",
    { managerId: z.string().describe("Manager customer id, digits only") },
    async ({ managerId }) => {
      try {
        const googleAds = await createGoogleAds();
        return ok(await listClientAccounts(googleAds.client, managerId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_keyword_ideas",
    "Keyword research: search volume, competition, and top-of-page bid range for seed terms and/or a landing page. The sizing step before committing budget, equivalent to estimating audience reach on LinkedIn.",
    KeywordIdeasSchema.shape,
    async (args) => {
      try {
        const googleAds = await createGoogleAds();
        const customerId = await requireCustomerId(args.customerId);
        return ok(await generateKeywordIdeas(googleAds.client, customerId, args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_list_campaigns",
    "Account structure: campaigns with their ad groups nested. Paused campaigns are included.",
    ListGoogleCampaignsSchema.shape,
    async (args) => {
      try {
        const googleAds = await createGoogleAds();
        const customerId = await requireCustomerId(args.customerId);
        return ok(await listCampaigns(googleAds.client, customerId, { includeRemoved: args.includeRemoved }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_list_ads",
    "Ads in an ad group, with their responsive-search headlines and descriptions.",
    { customerId: z.string().optional(), adGroupId: z.string() },
    async ({ customerId, adGroupId }) => {
      try {
        const googleAds = await createGoogleAds();
        return ok(await listAds(googleAds.client, await requireCustomerId(customerId), { adGroupId }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_list_conversion_actions",
    "Conversion actions on the account, so a launch can name one instead of guessing an id.",
    { customerId: z.string().optional() },
    async ({ customerId }) => {
      try {
        const googleAds = await createGoogleAds();
        return ok(await listConversionActions(googleAds.client, await requireCustomerId(customerId)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_launch_search_campaign",
    [
      "Create a PAUSED Search campaign from a brief: budget, campaign, geo/language targeting, ad groups, keywords, and responsive search ads, all in one atomic mutate.",
      "Defaults to validateOnly=true, which asks Google to validate the whole batch and persist nothing. Show the returned plan to the user and only re-call with validateOnly=false after they confirm.",
      "House rules are applied automatically and cannot be overridden: search network only (display expansion and search partners off), physical-presence-only location targeting, and Manual CPC.",
      "Nothing created here can serve. Activation is a human step in the Google Ads UI.",
    ].join(" "),
    SearchCampaignBriefSchema.shape,
    async (args) => {
      try {
        const googleAds = await createGoogleAds();
        return ok(await launchSearchCampaign(googleAds.client, args));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_performance",
    "Performance rows at campaign, ad_group, ad, keyword, or search_term level, with totals and derived KPIs (CTR, CPC, CPM, conversion rate, cost per conversion).",
    GooglePerformanceSchema.shape,
    async (args) => {
      try {
        const googleAds = await createGoogleAds();
        const customerId = await requireCustomerId(args.customerId);
        const rows = await getGooglePerformance(googleAds.client, customerId, {
          level: args.level,
          campaignId: args.campaignId,
          dateRange: resolveGoogleDateRange(args),
        });
        return ok({ dateRange: resolveGoogleDateRange(args), totals: aggregateGoogle(rows), rows });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "gads_search",
    "Run a raw GAQL query against the account. Read-only escape hatch for anything the other tools do not cover.",
    GoogleSearchSchema.shape,
    async ({ customerId, query }) => {
      try {
        // GAQL has no write form, but reject anything that is not a SELECT so a
        // confused caller gets a clear message rather than an API error.
        if (!/^\s*SELECT\b/i.test(query)) {
          return fail(new Error("gads_search only runs SELECT queries. Use gads_launch_search_campaign to create things."));
        }
        const googleAds = await createGoogleAds();
        return ok(await gaqlSearch(googleAds.client, await requireCustomerId(customerId), query));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
