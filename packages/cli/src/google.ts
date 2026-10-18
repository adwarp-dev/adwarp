import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  googleLogin,
  createGoogleAds,
  listAccessibleCustomers,
  listClientAccounts,
  listCampaigns as listGoogleCampaigns,
  listAds as listGoogleAds,
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
} from "@adwarp/google";

const pctf = (x: number) => `${(x * 100).toFixed(2)}%`;
const money = (x: number) => x.toFixed(2);

/**
 * The `adwarp google ...` command tree. Kept in its own module so the LinkedIn
 * CLI stays readable; both trees hang off the same `adwarp` binary because they
 * share the change journal and, increasingly, the same weekly question.
 */
export function registerGoogleCommands(program: Command): void {
  const google = program.command("google").description("Google Ads (paused-only campaign creation, keywords, reporting)");

  /* ---------------------------------- auth ---------------------------------- */

  const auth = google.command("auth").description("Google Ads authentication");
  auth
    .command("login")
    .description("Run the OAuth flow and store tokens in google-credentials.json in the Adwarp folder")
    .action(async () => {
      const creds = await googleLogin();
      console.log(`Authenticated. Scopes: ${creds.scope ?? "(unknown)"}`);
      if (!creds.refreshToken) {
        console.log(
          "Warning: no refresh token returned. Re-run after removing this app's access at myaccount.google.com/permissions.",
        );
      }
    });

  /* -------------------------------- accounts -------------------------------- */

  const accounts = google.command("accounts").description("Accessible Google Ads accounts");
  accounts
    .command("list")
    .description("Every customer this login can reach (proves the token and OAuth client work)")
    .action(async () => {
      const googleAds = await createGoogleAds();
      for (const c of await listAccessibleCustomers(googleAds.client)) {
        const tags = [c.manager ? "manager" : null, c.testAccount ? "test" : null].filter(Boolean).join(",");
        console.log(
          `${c.id}\t${c.name ?? "(unreadable)"}\t${c.currencyCode ?? ""}${tags ? `\t[${tags}]` : ""}${c.note ? `\t${c.note}` : ""}`,
        );
      }
    });
  accounts
    .command("clients <managerId>")
    .description("Client accounts under a manager account")
    .action(async (managerId: string) => {
      const googleAds = await createGoogleAds();
      for (const c of await listClientAccounts(googleAds.client, managerId)) {
        console.log(`${c.id}\t${c.name ?? ""}\t${c.currencyCode ?? ""}${c.manager ? "\t[manager]" : ""}`);
      }
    });

  /* -------------------------------- keywords -------------------------------- */

  google
    .command("keywords <seeds...>")
    .description("Keyword ideas with search volume, competition, and top-of-page bids")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .option("-u, --url <url>", "Also mine a landing page for ideas")
    .option("-l, --location <codes>", "Comma-separated country codes", "US")
    .option("--language <code>", "ISO language code", "en")
    .option("-n, --limit <n>", "Max ideas", "50")
    .action(async (seeds: string[], opts) => {
      const googleAds = await createGoogleAds();
      const input = KeywordIdeasSchema.parse({
        seeds,
        pageUrl: opts.url,
        locations: String(opts.location).split(","),
        languages: [opts.language],
        limit: Number(opts.limit),
      });
      const customerId = await requireCustomerId(opts.customer);
      const ideas = await generateKeywordIdeas(googleAds.client, customerId, input);
      console.log("volume\tcompetition\tbid range\tkeyword");
      for (const i of ideas) {
        console.log(
          `${i.avgMonthlySearches}\t${i.competition}\t${money(i.lowTopOfPageBid)}-${money(i.highTopOfPageBid)}\t${i.text}`,
        );
      }
    });

  /* ------------------------------- structure -------------------------------- */

  const campaigns = google.command("campaigns").description("Account structure, paused campaigns included");
  campaigns
    .command("list")
    .description("Campaigns with their ad groups")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .option("--all", "Include removed campaigns")
    .action(async (opts) => {
      const googleAds = await createGoogleAds();
      const customerId = await requireCustomerId(opts.customer);
      for (const c of await listGoogleCampaigns(googleAds.client, customerId, { includeRemoved: opts.all })) {
        console.log(`${c.id}\t${c.status}\t${c.channelType}\t${money(c.dailyBudget)}/day\t${c.name}`);
        for (const g of c.adGroups ?? []) console.log(`  ${g.id}\t${g.status}\t${g.name}`);
      }
    });

  google
    .command("ads <adGroupId>")
    .description("Ads in an ad group, with their responsive-search copy")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .action(async (adGroupId: string, opts) => {
      const googleAds = await createGoogleAds();
      const customerId = await requireCustomerId(opts.customer);
      for (const a of await listGoogleAds(googleAds.client, customerId, { adGroupId })) {
        console.log(`${a.id}\t${a.status}\t${a.type}`);
        console.log(`  headlines: ${a.headlines.join(" | ")}`);
        console.log(`  descriptions: ${a.descriptions.join(" | ")}`);
      }
    });

  const conversions = google.command("conversions").description("Conversion actions");
  conversions
    .command("list")
    .description("Conversion actions on the account, to name one in a brief")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .action(async (opts) => {
      const googleAds = await createGoogleAds();
      const customerId = await requireCustomerId(opts.customer);
      for (const c of await listConversionActions(googleAds.client, customerId)) {
        console.log(`${c.id}\t${c.status}\t${c.primaryForGoal ? "primary" : "secondary"}\t${c.category}\t${c.name}`);
      }
    });

  /* --------------------------------- launch --------------------------------- */

  google
    .command("launch")
    .description("Create a paused Search campaign from a brief. Dry run unless --apply is given.")
    .requiredOption("-b, --brief <path>", "Path to a brief JSON file")
    .option("--apply", "Actually create it. Without this, the brief is only validated server-side.")
    .action(async (opts) => {
      const raw = JSON.parse(await readFile(opts.brief, "utf8"));
      // The schema defaults validateOnly to true, so a dry run is what you get
      // unless --apply is explicit.
      const brief = SearchCampaignBriefSchema.parse({ ...raw, validateOnly: !opts.apply });
      const googleAds = await createGoogleAds();
      const result = await launchSearchCampaign(googleAds.client, brief);

      console.log(`Customer ${result.customerId} — ${result.operations} operations\n`);
      for (const p of result.plan) console.log(`  ${p.kind.padEnd(18)} ${p.name}${p.detail ? `  (${p.detail})` : ""}`);

      if (result.warnings.length) {
        console.log("\nWarnings:");
        for (const w of result.warnings) console.log(`  ${w}`);
      }

      if (result.validateOnly) {
        console.log("\nValidated by Google. Nothing was created. Re-run with --apply to create it.");
        return;
      }
      console.log(`\nCreated campaign ${result.campaignId} (PAUSED)`);
      console.log(`  ad groups: ${result.adGroupIds.join(", ") || "(none)"}`);
      console.log(`  ads: ${result.adIds.length}, keywords: ${result.keywordCount}`);
      console.log(`  ${result.links.campaigns}`);
      console.log("\nEverything is PAUSED. Turn it on in the Google Ads UI when you are ready.");
    });

  /* -------------------------------- reporting ------------------------------- */

  const report = google.command("report").description("Performance reporting");
  report
    .command("perf <level>")
    .description("Per-entity rows (campaign|ad_group|ad|keyword|search_term)")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .option("-p, --period <period>", "last_7_days|last_30_days|last_90_days|month_to_date|last_month", "last_30_days")
    .option("--campaign <id>", "Restrict to one campaign")
    .action(async (level, opts) => {
      const googleAds = await createGoogleAds();
      const customerId = await requireCustomerId(opts.customer);
      const rows = await getGooglePerformance(googleAds.client, customerId, {
        level,
        campaignId: opts.campaign,
        dateRange: resolveGoogleDateRange({ period: opts.period }),
      });
      const t = aggregateGoogle(rows);
      console.log(
        `TOTALS  spend ${money(t.cost)}  impr ${t.impressions}  clicks ${t.clicks}  CTR ${pctf(t.ctr)}  conv ${t.conversions}  cost/conv ${money(t.costPerConversion)}\n`,
      );
      for (const r of rows) {
        console.log(
          `${money(r.cost)}\timpr ${r.impressions}\tCTR ${pctf(r.ctr)}\tCPC ${money(r.cpc)}\tconv ${r.conversions}\t${r.name}${r.parent ? `\t(${r.parent})` : ""}`,
        );
      }
    });

  google
    .command("query <gaql>")
    .description("Run a raw GAQL query (read-only escape hatch)")
    .option("-c, --customer <id>", "Customer id (defaults to config)")
    .action(async (query: string, opts) => {
      const googleAds = await createGoogleAds();
      const customerId = await requireCustomerId(opts.customer);
      console.log(JSON.stringify(await gaqlSearch(googleAds.client, customerId, query), null, 2));
    });
}
