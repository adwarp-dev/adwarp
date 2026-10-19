#!/usr/bin/env node
import { getRemoteCreatives } from "@adwarp/core";
import { Command } from "commander";
import {
  login,
  exportHostedEnv,
  createLinkedInAds,
  listAdAccounts,
  uploadAudienceFromFile,
  cleanAudienceCsv,
  getDmpSegment,
  launchFromBrief,
  requireDefaultAccountId,
  searchTargeting,
  estimateAudience,
  audienceFromSalesforce,
  audienceFromHubSpot,
  previewHubSpotAudience,
  parseHubSpotFilter,
  type HubSpotFilter,
  listConversions,
  performanceSummary,
  getPerformance,
  performanceTrend,
  resolveDateRange,
  scanCompetitorAds,
  parseAdvertiserQuery,
  recordChange,
  readChanges,
  computeLift,
  normalizeEntityType,
  changelogPath,
  LIFT_METRICS,
  listCampaignGroups,
  listCampaigns,
  listCreatives,
  deleteAd,
  updateAd,
  getCreative,
  type AdStatus,
  getCampaign,
  updateCampaign,
  adSegmentUrn,
  MIN_AUDIENCE_TO_SERVE,
  OptimizationTargetSchema,
  type OptimizationTarget,
} from "@adwarp/core";
import { VERSION } from "@adwarp/shared";
import { registerGoogleCommands } from "./google.js";

const program = new Command();
program
  .name("adwarp")
  .description("Adwarp, the open-source ad agent for LinkedIn and Google Ads (CLI)")
  .version(VERSION);

// Google Ads lives under `adwarp google ...`; LinkedIn keeps the top level it has
// always had, so no existing command or script changes.
registerGoogleCommands(program);

// Same server as the adwarp-mcp command, so an MCP client config can be `npx -y adwarp mcp`.
program
  .command("mcp")
  .description("Start the MCP server on stdio, for Claude Code, Claude Desktop, Cursor, Codex, or other MCP clients that can run a local server")
  .action(async () => {
    const { startStdioServer } = await import("@adwarp/mcp/server");
    await startStdioServer();
  });

/** The public hosted MCP endpoint (see docs/hosted.md, published at adwarp.dev/docs/hosted). */
const HOSTED_MCP_URL = "https://mcp.adwarp.dev/api/mcp";

const auth = program.command("auth").description("Authentication");
auth
  .command("login")
  .description("Run the OAuth flow and store tokens")
  .action(async () => {
    const creds = await login();
    console.log(`Authenticated. Scopes: ${creds.scope ?? "(unknown)"}`);
  });

auth
  .command("export")
  .description("Print env vars for a self-hosted (Vercel) MCP server, or --mcp for a hosted connect command")
  .option(
    "--mcp [url]",
    "Print the `claude mcp add` command that connects your credentials to a hosted Adwarp MCP endpoint",
  )
  .action(async (opts: { mcp?: string | boolean }) => {
    const env = await exportHostedEnv();
    if (opts.mcp) {
      const url = typeof opts.mcp === "string" ? opts.mcp : HOSTED_MCP_URL;
      const { loadConfig } = await import("@adwarp/core");
      const config = await loadConfig();
      const headers = [
        `--header "X-Adwarp-Linkedin-Client-Id: ${env.ADWARP_LINKEDIN_CLIENT_ID}"`,
        `--header "X-Adwarp-Linkedin-Client-Secret: ${env.ADWARP_LINKEDIN_CLIENT_SECRET}"`,
        `--header "X-Adwarp-Linkedin-Refresh-Token: ${env.ADWARP_LINKEDIN_REFRESH_TOKEN}"`,
      ];
      if (config.defaultAccountId) headers.push(`--header "X-Adwarp-Linkedin-Account-Id: ${config.defaultAccountId}"`);
      if (env.ADWARP_LINKEDIN_VERSION) headers.push(`--header "X-Adwarp-Linkedin-Version: ${env.ADWARP_LINKEDIN_VERSION}"`);
      console.log(["claude mcp add --transport http adwarp", url, ...headers].join(" \\\n  "));
      console.warn(
        "! This command carries your app secret and refresh token. Your credentials ride along on every call to that server, so only point it at a deployment you trust, or self-host: https://adwarp.dev/docs/hosted#self-host-on-vercel",
      );
      return;
    }
    for (const [k, v] of Object.entries(env)) if (v) console.log(`${k}=${v}`);
    console.warn("! Treat these as secrets. Paste into Vercel project env, do not commit.");
  });

const accounts = program.command("accounts").description("Ad accounts");
accounts
  .command("list")
  .description("List accessible ad accounts")
  .action(async () => {
    const linkedinAds = await createLinkedInAds();
    const list = await listAdAccounts(linkedinAds.client);
    if (list.length === 0) {
      console.log("No ad accounts found. Map your account in the Developer Portal > Products > View Ad Accounts.");
      return;
    }
    for (const a of list) console.log(`${a.id}\t${a.status}\t${a.name}`);
  });

const audience = program.command("audience").description("Matched audiences");
audience
  .command("upload")
  .description("Clean a CSV (fix columns, drop extras, domains->URLs) and upload as a matched audience")
  .requiredOption("-n, --name <name>", "Audience name")
  .requiredOption("-f, --csv <path>", "CSV file path")
  .option("-a, --account <id>", "Ad account id (defaults to config defaultAccountId)")
  .option("-t, --type <type>", "contact|company (auto-detected if omitted)")
  .option("--dry-run", "Show the cleaned result without uploading")
  .action(async (opts) => {
    const { readFile } = await import("node:fs/promises");
    if (opts.dryRun) {
      const clean = cleanAudienceCsv(await readFile(opts.csv, "utf8"), { type: opts.type });
      console.log(`type: ${clean.type} | rows: ${clean.rowCount} | kept columns: ${clean.columns.join(", ")}`);
      if (clean.dropped.length) console.log(`dropped: ${clean.dropped.join(", ")}`);
      clean.warnings.forEach((w: string) => console.warn(`! ${w}`));
      console.log("\nsample:");
      console.log(clean.columns.join(","));
      clean.rows.slice(0, 3).forEach((r) => console.log(clean.columns.map((c) => r[c] ?? "").join(",")));
      return;
    }
    const linkedinAds = await createLinkedInAds();
    const res = await uploadAudienceFromFile(linkedinAds.client, linkedinAds.getToken, {
      accountId: opts.account ?? (await requireDefaultAccountId()),
      name: opts.name,
      csvPath: opts.csv,
      type: opts.type,
    });
    console.log(`Segment ${res.segmentId} (${res.audienceType}), status ${res.status}`);
    console.log(`Uploaded ${res.uploaded} (${res.skipped} skipped of ${res.totalRows} rows).`);
    res.warnings.forEach((w: string) => console.warn(`! ${w}`));
  });

audience
  .command("from-salesforce")
  .description("Build a matched audience from a Salesforce SOQL query")
  .requiredOption("-n, --name <name>", "Audience name")
  .requiredOption("-q, --soql <query>", "SOQL selecting an email column")
  .option("-a, --account <id>", "Ad account id (defaults to config defaultAccountId)")
  .option("--email-field <col>", "Email column name if not 'Email'")
  .action(async (opts) => {
    const linkedinAds = await createLinkedInAds();
    const res = await audienceFromSalesforce(linkedinAds.client, linkedinAds.getToken, {
      accountId: opts.account ?? (await requireDefaultAccountId()),
      name: opts.name,
      soql: opts.soql,
      emailField: opts.emailField,
    });
    console.log(`Fetched ${res.fetchedFromSalesforce} emails from Salesforce.`);
    console.log(`Segment ${res.segmentId}, status ${res.status} (${res.uploaded} uploaded).`);
    res.warnings.forEach((w: string) => console.warn(`! ${w}`));
  });

const collect = (value: string, previous: string[]) => [...previous, value];

audience
  .command("from-hubspot")
  .description("Build a matched audience from HubSpot contacts or companies: a list, or CRM search filters")
  .requiredOption("-n, --name <name>", "Audience name")
  .option("--list <id>", "HubSpot list id (its members become the audience)")
  .option("--filter <prop:op:value>", "CRM search filter, repeatable and ANDed, e.g. lifecyclestage:EQ:customer", collect, [])
  .option("-t, --type <type>", "contact|company (defaults to the list's type, or contact for filters)")
  .option("-a, --account <id>", "Ad account id (defaults to config defaultAccountId)")
  .option("--dry-run", "Show counts and a masked sample without uploading")
  .action(async (opts: { name: string; list?: string; filter: string[]; type?: "contact" | "company"; account?: string; dryRun?: boolean }) => {
    if (opts.type && opts.type !== "contact" && opts.type !== "company") {
      throw new Error(`--type must be contact or company, got "${opts.type}".`);
    }
    const filters: HubSpotFilter[] | undefined = opts.filter.length ? opts.filter.map(parseHubSpotFilter) : undefined;
    const input = { name: opts.name, type: opts.type, listId: opts.list, filters };
    const reasons = (r: Record<string, number>) =>
      Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ");
    if (opts.dryRun) {
      const p = await previewHubSpotAudience(input);
      const from = p.source.kind === "list" ? `list ${p.source.listId} "${p.source.listName}"` : "search";
      console.log(`HubSpot ${from} (${p.audienceType})`);
      console.log(`read: ${p.read} | valid: ${p.valid} | skipped: ${p.skipped}${p.skipped ? ` (${reasons(p.skippedReasons)})` : ""}`);
      p.warnings.forEach((w: string) => console.warn(`! ${w}`));
      if (p.sample.length) {
        console.log("\nsample:");
        console.log(p.columns.join(","));
        p.sample.forEach((row) => console.log(p.columns.map((c) => row[c] ?? "").join(",")));
      }
      return;
    }
    const linkedinAds = await createLinkedInAds();
    const res = await audienceFromHubSpot(linkedinAds.client, linkedinAds.getToken, {
      ...input,
      accountId: opts.account ?? (await requireDefaultAccountId()),
    });
    console.log(`Read ${res.read} ${res.audienceType === "contact" ? "contacts" : "companies"} from HubSpot.`);
    console.log(`Segment ${res.segmentId} (${res.audienceType}), status ${res.status} (${res.uploaded} uploaded).`);
    if (res.skipped) console.log(`Skipped ${res.skipped}: ${reasons(res.skippedReasons)}.`);
    res.warnings.forEach((w: string) => console.warn(`! ${w}`));
  });

audience
  .command("status <segmentId>")
  .description("Check a DMP segment's matching status")
  .action(async (segmentId: string) => {
    const linkedinAds = await createLinkedInAds();
    const s = await getDmpSegment(linkedinAds.client, segmentId);
    console.log(JSON.stringify(s, null, 2));
  });

const targeting = program.command("targeting").description("Audience targeting");
targeting
  .command("search <facet> <query>")
  .description("Typeahead-search entities in a facet (e.g. titles 'marketing')")
  .action(async (facet: string, query: string) => {
    const linkedinAds = await createLinkedInAds();
    const entities = await searchTargeting(linkedinAds.client, facet, query);
    for (const e of entities) console.log(`${e.urn}\t${e.name}`);
  });
targeting
  .command("estimate <facet> <urns...>")
  .description("Estimate audience size for one facet's URNs (comma/space separated)")
  .action(async (facet: string, urns: string[]) => {
    const linkedinAds = await createLinkedInAds();
    const est = await estimateAudience(linkedinAds.client, { include: { [facet]: urns } });
    console.log(`total ${est.total} | active ${est.active} | canServe ${est.canServe}`);
  });

const conversions = program.command("conversions").description("Conversions (insight tags)");
conversions
  .command("list")
  .description("List the account's conversions to select one for a campaign")
  .option("-a, --account <id>", "Ad account id (defaults to config defaultAccountId)")
  .action(async (opts) => {
    const linkedinAds = await createLinkedInAds();
    const acct = opts.account ?? (await requireDefaultAccountId());
    const list = await listConversions(linkedinAds.client, acct);
    for (const c of list) console.log(`${c.id}\t${c.enabled ? "on " : "off"}\t${c.type}\t${c.name}`);
  });

const pctf = (x: number) => `${(x * 100).toFixed(2)}%`;
const report = program.command("report").description("Performance reporting and insights");
report
  .command("summary")
  .description("Account rollup: totals, top/bottom performers, flags")
  .option("-a, --account <id>", "Ad account id (defaults to config)")
  .option("-p, --period <period>", "last_7_days|last_30_days|last_90_days|month_to_date|last_month", "last_30_days")
  .action(async (opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const s = await performanceSummary(linkedinAds.client, { accountId, dateRange: resolveDateRange({ period: opts.period }) });
    const t = s.totals;
    console.log(`TOTALS  spend $${t.costUsd}  impr ${t.impressions}  clicks ${t.clicks}  CTR ${pctf(t.ctr)}  conv ${t.conversions}  CPL/conv $${t.costPerConversion}`);
    console.log("\nTop campaigns by spend:");
    for (const g of s.topBySpend) console.log(`  $${g.costUsd}\tCTR ${pctf(g.ctr)}\tconv ${g.conversions}\t${g.name ?? g.entityId}`);
    if (s.flags.length) {
      console.log("\nFlags:");
      for (const f of s.flags) console.log(`  [${f.kind}] ${f.name ?? f.entityUrn}: ${f.detail}`);
    }
  });
report
  .command("perf <level>")
  .description("Per-entity rows (account|campaign_group|campaign|creative)")
  .option("-a, --account <id>", "Ad account id (defaults to config)")
  .option("--parent <id>", "Parent group id (campaigns) or campaign id (creatives)")
  .option("-p, --period <period>", "Date period", "last_30_days")
  .action(async (level, opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const rows = await getPerformance(linkedinAds.client, { accountId, level, parentId: opts.parent, dateRange: resolveDateRange({ period: opts.period }) });
    for (const r of rows) console.log(`$${r.costUsd}\timpr ${r.impressions}\tCTR ${pctf(r.ctr)}\tCPC $${r.cpc}\tconv ${r.conversions}\t${r.name ?? r.entityId}`);
  });
report
  .command("trend <level> <entityId>")
  .description("Weekly or monthly trend with deltas")
  .option("-b, --bucket <bucket>", "weekly|monthly", "weekly")
  .option("-p, --period <period>", "Date period", "last_90_days")
  .action(async (level, entityId, opts) => {
    const linkedinAds = await createLinkedInAds();
    const points = await performanceTrend(linkedinAds.client, { level, entityId, bucket: opts.bucket, dateRange: resolveDateRange({ period: opts.period }) });
    for (const p of points) {
      const dc = p.deltas?.costUsd;
      const d = dc !== undefined ? ` (spend ${dc >= 0 ? "+" : ""}${pctf(dc)})` : "";
      console.log(`${p.periodStart}\t$${p.costUsd}\timpr ${p.impressions}\tCTR ${pctf(p.ctr)}\tconv ${p.conversions}${d}`);
    }
  });

const fmtDelta = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const changelog = program.command("changelog").description("Local journal of ad changes (for lift comparison)");
changelog
  .command("add")
  .description("Manually log a change (e.g. one made in Campaign Manager) to the journal")
  .requiredOption("-t, --type <type>", "campaignGroup|campaign|creative")
  .requiredOption("-i, --id <entityId>", "Entity id the change applies to")
  .option("-f, --field <name>", "Name of the field that changed (e.g. dailyBudget, headline)")
  .option("--before <value>", "Prior value of the field")
  .option("--after <value>", "New value of the field")
  .option("-n, --note <text>", "Freeform note instead of a field change")
  .option("-l, --label <text>", "Hypothesis/label for this change (e.g. 'outcome-led headline test')")
  .option("--name <name>", "Human name of the entity (for nicer listings)")
  .option("--tags <list>", "Comma-separated tags")
  .option("--at <iso>", "When the change took effect (ISO 8601); defaults to now")
  .action(async (opts) => {
    const type = normalizeEntityType(opts.type);
    const tags = opts.tags ? String(opts.tags).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
    const isUpdate = Boolean(opts.field);
    const event = await recordChange({
      source: "manual",
      kind: isUpdate ? "update" : "note",
      entity: { type, id: opts.id, name: opts.name },
      fields: isUpdate ? [{ field: opts.field, before: opts.before, after: opts.after }] : undefined,
      summary: isUpdate ? `${opts.field} → ${opts.after ?? "(set)"}` : opts.note,
      label: opts.label,
      tags,
      ts: opts.at,
    });
    console.log(`Logged ${event.id}, ${event.entity.type} ${event.entity.id}: ${event.summary ?? "(no summary)"}`);
    console.log(`Journal: ${changelogPath()}`);
  });
changelog
  .command("list")
  .description("List recorded changes, newest first")
  .option("-t, --type <type>", "Filter by campaignGroup|campaign|creative")
  .option("-i, --id <entityId>", "Filter by entity id")
  .option("--tag <tag>", "Filter by tag")
  .option("-n, --limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
  .option("--json", "Print raw JSON")
  .action(async (opts) => {
    const type = opts.type ? normalizeEntityType(opts.type) : undefined;
    const all = await readChanges({ type, id: opts.id, tag: opts.tag });
    const rows = all.slice(0, opts.limit);
    if (opts.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log(`No changes recorded yet. Journal: ${changelogPath()}`);
      return;
    }
    for (const e of rows) {
      const when = e.ts.slice(0, 16).replace("T", " ");
      const who = e.source === "manual" ? "man " : "auto";
      const label = e.label ? `  «${e.label}»` : "";
      console.log(`${when}  ${who}  ${e.entity.type}/${e.entity.id}  ${e.summary ?? e.kind}${label}`);
    }
    console.log(`\n${rows.length} of ${all.length} change(s). Run \`adwarp lift <level> <entityId>\` to measure performance lift.`);
  });

program
  .command("lift <level> <entityId>")
  .description("Compare performance before vs. after each recorded change to an entity (level: campaign_group|campaign|creative)")
  .option("-w, --window <days>", "Days on each side of a change", (v) => parseInt(v, 10), 14)
  .option("--json", "Print raw JSON")
  .action(async (level, entityId, opts) => {
    const type = normalizeEntityType(level);
    const linkedinAds = await createLinkedInAds();
    const lifts = await computeLift(linkedinAds.client, { type, entityId, windowDays: opts.window });
    if (opts.json) {
      console.log(JSON.stringify(lifts, null, 2));
      return;
    }
    if (lifts.length === 0) {
      console.log(`No recorded changes for ${type} ${entityId}. Log one with \`adwarp changelog add\`, or let Adwarp capture changes automatically.`);
      return;
    }
    console.log(`Lift for ${type} ${entityId}: ${opts.window}d before vs. after each change`);
    console.log(`(directional pre/post comparison; confounded by seasonality, learning phase, and budget changes)\n`);
    for (const l of lifts) {
      const when = l.change.ts.slice(0, 10);
      const label = l.change.label ? ` «${l.change.label}»` : "";
      console.log(`▸ ${when}  ${l.change.summary ?? l.change.kind}${label}`);
      console.log(`    before ${l.before.start}…${l.before.end}   after ${l.after.start}…${l.after.end}${l.after.partial ? ` (partial, ${l.after.days}d)` : ""}`);
      for (const k of LIFT_METRICS) {
        const b = l.before.metrics[k] as number;
        const a = l.after.metrics[k] as number;
        console.log(`    ${k.padEnd(18)} ${String(b).padStart(10)} → ${String(a).padStart(10)}   ${fmtDelta(l.deltas[k] ?? 0)}`);
      }
      console.log("");
    }
  });

const competitor = program.command("competitor").description("Competitor ad intelligence (public LinkedIn Ad Library)");
competitor
  .command("ads <advertiser>")
  .description("Discover competitor ads through the official API. Supply advertiser name plus --company-id for remote creatives.")
  .option("--company-id <id>", "Force a numeric LinkedIn company id (most precise)")
  .option("-k, --keyword <text>", "Keyword search across ad copy instead of an advertiser")
  .option("-c, --country <codes>", "Comma-separated ISO country codes, e.g. US,GB")
  .option("-e, --engine <engine>", "auto | api (local scraper removed)", "auto")
  .option("-m, --max <n>", "Max ads to collect", (v) => parseInt(v, 10), 50)
  .option("--no-deep", "Skip remote creative collection (API metadata only)")
  .option("--copy-max <n>", "Remote creative sample size (default and maximum 10)", (v) => parseInt(v, 10))
  .option("--concurrency <n>", "Deprecated: remote worker concurrency is fixed at 1", (v) => parseInt(v, 10))
  .option("--json", "Print raw JSON instead of a summary")
  .action(async (advertiser: string, opts) => {
    const parsed = parseAdvertiserQuery(advertiser);
    const scan = await scanCompetitorAds({
      advertiser: parsed.advertiser,
      companyId: opts.companyId ?? parsed.companyId,
      keyword: opts.keyword ?? parsed.keyword,
      countries: opts.country ? String(opts.country).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined,
      engine: opts.engine,
      max: opts.max,
      deep: opts.deep,
      copyMax: opts.copyMax,
      concurrency: opts.concurrency,
      onProgress: (m) => console.error(`… ${m}`),
    });
    if (opts.json) {
      console.log(JSON.stringify(scan, null, 2));
      return;
    }
    const q = scan.query.advertiser ?? scan.query.companyId ?? scan.query.keyword;
    console.log(`\n${q}: ${scan.fetched} ads via ${scan.engine}${scan.totalReported ? ` (library reports ${scan.totalReported} total)` : ""}`);
    if (scan.note) console.log(scan.note);
    console.log("");
    scan.ads.forEach((a, i) => {
      const d = a.detail;
      const sponsor = a.promotedBy ? ` [${a.promotedBy}]` : "";
      const fmt = (d?.format ?? a.format) ? ` {${d?.format ?? a.format}}` : "";
      const ran = d?.ranFrom ? `  ran ${d.ranFrom}${d.ranTo && d.ranTo !== d.ranFrom ? `→${d.ranTo}` : ""}` : "";
      const impr = d?.totalImpressions ? `  impr ${d.totalImpressions}` : "";
      const geo = d?.impressionsByCountry?.length ? `  geo ${d.impressionsByCountry.slice(0, 3).map((c) => `${c.country} ${c.share}`).join(", ")}` : "";
      console.log(`${String(i + 1).padStart(2)}. ${a.advertiser}${sponsor}${fmt}${ran}${impr}${geo}`);
      const copy = (a.commentary ?? "").replace(/\s+/g, " ").trim();
      if (copy) console.log(`    “${copy.slice(0, 180)}${copy.length > 180 ? "…" : ""}”`);
      if (d?.targeting?.length) {
        const tg = d.targeting
          .map((t) => `${t.facet}: ${[...t.included, ...t.excluded.map((e) => `-${e}`)].join("/")}`)
          .join("  ·  ");
        console.log(`    🎯 ${tg}`);
      }
      console.log(`    ${a.detailUrl}`);
    });
    console.log(`\nReview the copy + formats + targeting + cadence above to synthesize messaging themes and how this account is run.`);
  });

program
  .command("launch")
  .description("Launch a draft campaign from a brief JSON file")
  .requiredOption("-b, --brief <path>", "Path to a LaunchFromBrief JSON file")
  .action(async (opts) => {
    const { readFile } = await import("node:fs/promises");
    const input = JSON.parse(await readFile(opts.brief, "utf8"));
    if (!input.accountId) input.accountId = await requireDefaultAccountId();
    const linkedinAds = await createLinkedInAds();
    const res = await launchFromBrief(linkedinAds, input);
    console.log("Created (all DRAFT):");
    console.log(`  Campaign group: ${res.campaignGroupId}`);
    console.log(`  Campaign:       ${res.campaignId}`);
    console.log(`  Creatives:      ${res.creativeIds.join(", ") || "(none)"}`);
    console.log(`  Review: ${res.links.campaign}`);
    res.warnings.forEach((w: string) => console.warn(`! ${w}`));
  });

const campaigns = program.command("campaigns").description("Account structure (campaign groups and ad groups), drafts included");
campaigns
  .command("list")
  .description("List campaign groups and their ad groups, drafts included (unlike report perf)")
  .option("--group <groupId>", "only ad groups in this campaign group")
  .option("--all", "include archived/removed entities")
  .option("--account <accountId>", "ad account id (defaults to config)")
  .action(async (opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const groups = await listCampaignGroups(linkedinAds.client, accountId, { includeArchived: opts.all });
    const list = await listCampaigns(linkedinAds.client, accountId, { groupId: opts.group, includeArchived: opts.all });
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    for (const g of groups) {
      if (opts.group && g.id !== opts.group) continue;
      console.log(`${g.id}\t${g.status}\t${g.name}`);
      for (const c of list.filter((c) => c.campaignGroupId === g.id)) {
        console.log(`  ${c.id}\t${c.status}\t${c.name}`);
      }
    }
    const orphans = list.filter((c) => !groupName.has(c.campaignGroupId));
    for (const c of orphans) console.log(`? ${c.id}\t${c.status}\t${c.name} (group ${c.campaignGroupId})`);
  });

campaigns
  .command("get <campaignId>")
  .description("Show a campaign (ad group): status, name, and its current targeting")
  .option("--account <accountId>", "ad account id (defaults to config)")
  .action(async (campaignId, opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const c = (await getCampaign(linkedinAds.client, accountId, campaignId)) as Record<string, unknown>;
    console.log(`${c.id ?? campaignId}\t${c.status ?? ""}\t${c.name ?? ""}`);
    if (c.creativeSelection) {
      const label = c.creativeSelection === "ROUND_ROBIN" ? "even (ROUND_ROBIN)" : String(c.creativeSelection);
      console.log(`ad rotation: ${label}`);
    }
    console.log("targetingCriteria:");
    console.log(JSON.stringify(c.targetingCriteria ?? {}, null, 2));
  });
campaigns
  .command("update <campaignId>")
  .description("Update a campaign (ad group) in place. Previews by default; add --apply to send.")
  .option("--account <accountId>", "ad account id (defaults to config)")
  .option("--audience <urnOrId>", "matched audience to target (adSegment urn or bare id), replaces targeting")
  .option("--geo <urns...>", "geo urns to include alongside the audience")
  .option("--targeting <json>", "structured targeting spec as JSON, e.g. '{\"include\":{...}}'")
  .option("--no-default-exclusions", "do not merge the standing default exclusions into new targeting")
  .option("--name <name>", "rename the campaign")
  .option("--status <status>", "DRAFT | ACTIVE | PAUSED | ARCHIVED")
  .option("--daily-budget <amount>", "daily budget amount, e.g. 100.00")
  .option("--total-budget <amount>", "total budget amount")
  .option("--bid <amount>", "bid (unit cost) amount")
  .option("--currency <code>", "currency for budgets/bid (default USD)", "USD")
  .option("--rotation <mode>", "ad rotation: even (ROUND_ROBIN) | optimized (OPTIMIZED)")
  .option(
    "--optimize <target>",
    "bidding strategy: max-clicks (Maximum Delivery on landing page clicks, sets costType CPM) | manual (NONE) | a raw LinkedIn optimizationTargetType",
  )
  .option("--cost-type <type>", "CPC | CPM | CPV (Maximum Delivery needs CPM)")
  .option("--apply", "actually send the update (otherwise just preview the patch)")
  .action(async (campaignId, opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const money = (amount?: string) => (amount ? { amount, currencyCode: opts.currency } : undefined);

    const targeting = opts.targeting ? JSON.parse(opts.targeting) : undefined;
    const input = {
      accountId,
      campaignId,
      audienceSegmentUrn: opts.audience ? adSegmentUrn(opts.audience) : undefined,
      geoUrns: opts.geo,
      targeting,
      applyDefaultExclusions: opts.defaultExclusions !== false,
      name: opts.name,
      status: opts.status,
      dailyBudget: money(opts.dailyBudget),
      totalBudget: money(opts.totalBudget),
      unitCost: money(opts.bid),
      creativeSelection: parseRotation(opts.rotation),
      optimizationTargetType: parseOptimize(opts.optimize),
      costType: opts.costType ?? (opts.optimize && opts.optimize !== "manual" ? "CPM" : undefined),
      dryRun: !opts.apply,
    };

    // When targeting is being replaced with a derivable spec, estimate the reach
    // so we catch the >=300 members-to-serve floor before (or as) we apply it.
    let spec: { include: Record<string, string[]>; exclude?: Record<string, string[]> } | undefined;
    if (targeting) spec = targeting;
    else if (opts.audience) {
      const include: Record<string, string[]> = { audienceMatchingSegments: [adSegmentUrn(opts.audience)] };
      if (opts.geo?.length) include.locations = opts.geo;
      spec = { include };
    }
    if (spec) {
      try {
        const est = await estimateAudience(linkedinAds.client, spec);
        const flag = est.total < MIN_AUDIENCE_TO_SERVE ? `  [WARNING] below ${MIN_AUDIENCE_TO_SERVE}, will NOT serve (note: forecast reads 0 for dynamicSegments/retargeting audiences, so verify real size in CM)` : "";
        console.log(`Estimated audience: ${est.total} total (${est.active} active)${flag}`);
      } catch (e) {
        console.log(`(could not estimate audience: ${e instanceof Error ? e.message : e})`);
      }
    }

    const res = await updateCampaign(linkedinAds.client, input as Parameters<typeof updateCampaign>[1]);
    if (res.dryRun) {
      console.log(`\nDRY RUN, nothing sent. Patch for campaign ${campaignId} (fields: ${res.updated.join(", ")}):`);
      console.log(JSON.stringify(res.patch, null, 2));
      console.log("\nRe-run with --apply to send this update.");
    } else {
      console.log(`Updated campaign ${res.id} (fields: ${res.updated.join(", ")}).`);
    }
  });

/** Map the --optimize flag to LinkedIn's optimizationTargetType enum. */
function parseOptimize(target?: string): OptimizationTarget | undefined {
  if (!target) return undefined;
  const t = target.toLowerCase();
  if (t === "max-clicks" || t === "max_click" || t === "clicks") return "MAX_CLICK";
  if (t === "manual" || t === "none") return "NONE";
  const raw = target.toUpperCase().replace(/-/g, "_");
  const parsed = OptimizationTargetSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new Error(`Unknown --optimize "${target}". Use max-clicks, manual, or a LinkedIn optimizationTargetType.`);
}

/** Map the --rotation flag to LinkedIn's creativeSelection enum. */
function parseRotation(mode?: string): "OPTIMIZED" | "ROUND_ROBIN" | undefined {
  if (mode === undefined) return undefined;
  const m = mode.trim().toLowerCase();
  if (["even", "evenly", "round_robin", "round-robin", "roundrobin"].includes(m)) return "ROUND_ROBIN";
  if (["optimized", "optimised", "auto"].includes(m)) return "OPTIMIZED";
  throw new Error(`Unknown --rotation "${mode}". Use "even" or "optimized".`);
}

const ad = program.command("ad").description("Individual ads (creatives)");
ad
  .command("list <campaignId>")
  .description("List ads in an ad group, drafts included")
  .option("--account <accountId>", "ad account id (defaults to config)")
  .action(async (campaignId, opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const ads = await listCreatives(linkedinAds.client, accountId, campaignId);
    if (ads.length === 0) {
      console.log("No ads in this ad group.");
      return;
    }
    for (const a of ads) console.log(`${a.id}\t${a.intendedStatus}\t${a.name || "(unnamed)"}`);
  });
ad
  .command("delete <creativeId>")
  .description("Delete an ad (creative + its Direct Sponsored Content post)")
  .option("--account <accountId>", "ad account id (defaults to config)")
  .action(async (creativeId, opts) => {
    const linkedinAds = await createLinkedInAds();
    const accountId = opts.account ?? (await requireDefaultAccountId());
    const res = await deleteAd(linkedinAds.client, accountId, creativeId);
    console.log(`Deleted ${res.creativeId}` + (res.postUrn ? ` (post ${res.postUrn}${res.postDeleted ? " deleted" : " left in place"})` : ""));
  });

/** `ad pause|resume|archive`: set a single ad's status. Previews by default, like `campaigns update`. */
function adStatusCommand(name: string, status: AdStatus, description: string) {
  ad
    .command(`${name} <creativeId>`)
    .description(`${description} Previews by default; add --apply to send.`)
    .option("--account <accountId>", "ad account id (defaults to config)")
    .option("--apply", `actually ${name} the ad (otherwise just preview the patch)`)
    .action(async (creativeId, opts) => {
      const linkedinAds = await createLinkedInAds();
      const accountId = opts.account ?? (await requireDefaultAccountId());
      const res = await updateAd(linkedinAds.client, { accountId, creativeId, status, dryRun: !opts.apply });
      if (!res.dryRun) {
        console.log(`Set ad ${res.creativeId} to ${res.intendedStatus}.`);
        return;
      }
      // Name the ad and its current status, so the preview shows what would change.
      try {
        const c = await getCreative(linkedinAds.client, accountId, res.creativeId);
        console.log(`${res.creativeId}\t${String(c.intendedStatus ?? "")}\t${String(c.name ?? "") || "(unnamed)"}`);
        if (status === "ACTIVE" && c.intendedStatus === "DRAFT") {
          console.log("This ad is a DRAFT: ACTIVE submits it for LinkedIn review, and it serves once approved.");
        }
      } catch (e) {
        console.log(`(could not read the ad: ${e instanceof Error ? e.message : e})`);
      }
      console.log(`\nDRY RUN, nothing sent. Patch: ${JSON.stringify(res.patch)}`);
      if (status === "ACTIVE") console.log("ACTIVE starts the ad serving and spending while its ad group is active.");
      console.log(`Re-run with --apply to ${name} it.`);
    });
}
adStatusCommand("pause", "PAUSED", "Pause a single ad (sets it PAUSED) so it stops serving.");
adStatusCommand("resume", "ACTIVE", "Resume an ad (sets it ACTIVE), which starts spend.");
adStatusCommand("archive", "ARCHIVED", "Archive an ad (sets it ARCHIVED).");

program.command("creative-status <ids>")
  .description("Read remote creative jobs without visiting LinkedIn; comma-separated ad IDs")
  .action(async (ids: string) => {
    console.log(JSON.stringify(await getRemoteCreatives(ids.split(",")), null, 2));
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
