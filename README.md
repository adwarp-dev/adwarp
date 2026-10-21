# Adwarp

[![npm](https://img.shields.io/npm/v/adwarp)](https://www.npmjs.com/package/adwarp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

[Website](https://adwarp.dev) · [Docs](https://adwarp.dev/docs) · [Install guide](https://adwarp.dev/docs/install) · [npm package](https://www.npmjs.com/package/adwarp)

**Adwarp** (formerly Liam) is the open-source ad agent for LinkedIn Ads and Google Ads.
Create campaigns by talking to Claude (MCP) or from a CLI. Built for go-to-market teams
who want to spin up many campaigns from a contact list and a brief, then add creative
images themselves. Everything starts switched off: LinkedIn entities are created as **drafts** and
Google entities as **paused**. A LinkedIn campaign goes live only when you explicitly
ask Adwarp to turn it on or switch it on yourself in Campaign Manager, and Google
campaigns can only be switched on in the Google Ads UI.

> Unofficial and not affiliated with or endorsed by LinkedIn or Google.

> Covers creation, matched audiences (including building one straight from Salesforce or HubSpot),
> conversion selection, performance reporting/insights, competitor ad intelligence, and a
> change journal with before/after lift. See [ROADMAP.md](./ROADMAP.md) for what's shipped
> and what's planned next.

## What you can do with it

Once Adwarp is connected, you talk to your assistant in plain language. Real requests it
handles today, roughly in the order a campaign comes together:

- "How many VPs of demand gen at US SaaS companies can we reach?" (resolves targeting
  facets, estimates reach before any money is involved)
- "Upload this CSV as a matched audience." (auto-cleans columns, hashes emails, converts
  company domains to URLs)
- "Build an audience from Salesforce: every contact on an account flagged as a target."
  (SOQL straight to a matched audience)
- "Turn our HubSpot target accounts list into a LinkedIn audience." (a HubSpot list or search
  straight to a matched audience of contacts or companies)
- "Launch a draft campaign for that audience, $100/day, tracking the demo-booked
  conversion." (campaign group + campaign + draft ads in one call)
- "What ads is our biggest competitor running right now, and what offers are they pushing?" (reads the
  public Ad Library: copy, formats, and EU targeting metadata for any company)
- "How did retargeting do last month vs the month before?" (trend report with deltas)
- "Which ads should I pause this week?" (account rollup with top/bottom performers and
  flags, then pauses the ads you pick, leaving the rest of each ad group running)
- "Rewrite the copy on the losing ad." (delete + recreate as a fresh draft; LinkedIn
  ignores edits to a live ad's post)
- "Did the new headline actually help?" (change journal + before/after lift)

Adwarp resolves the details and reports back the ids. Every capability is also an `adwarp`
CLI command for scripted or batch use.

### Put it on a loop

There is no scheduler in Adwarp. Use the one in whatever client you drive it from.
Some loops that work well:

- "Every Monday at 9am, pull last week's performance summary, compare it to the week
  before, and flag anything that moved more than 20%." (a Claude Code scheduled agent)
- "Every Friday, check what new ads our top three competitors shipped this week and
  summarize the angles."
- "Check the audience match status every few hours and tell me when it clears 300
  members." (the minimum for a matched audience to serve)
- Or skip the assistant entirely and put the CLI in cron:
  `0 9 * * 1 adwarp report summary -p last_7_days`

## Hierarchy mapping (the two platforms disagree)

LinkedIn's names are shifted one level from everyone else's, which is the single
most common source of confusion when working across both:

| Common term | LinkedIn entity    | Google Ads entity | Holds                                    |
| ----------- | ------------------ | ----------------- | ---------------------------------------- |
| Campaign    | **Campaign Group** | (none)            | status, total/shared budget              |
| Ad group    | **Campaign**       | **Campaign**      | targeting, budget, bid, schedule, format |
| (none)      | (none)             | **Ad group**      | keywords and the ads that answer them    |
| Ad          | **Creative**       | **Ad group ad**   | the rendered ad                          |
| Audience    | **DMP Segment**    | **User list**     | attached to targeting                    |

So a LinkedIn "campaign" and a Google "campaign" are not the same thing: Google's
campaign holds the budget and targeting (LinkedIn's *campaign group* plus
*campaign*), and its ad group holds keywords.

## Google Ads

Search campaigns only, creation-first. What is there today:

```bash
adwarp google auth login
adwarp google accounts list                       # proves the token and OAuth client work
adwarp google keywords "revops automation" --url https://example.com/product
adwarp google conversions list
adwarp google launch --brief examples/google-brief.json           # dry run
adwarp google launch --brief examples/google-brief.json --apply   # create it, paused
adwarp google campaigns list
adwarp google report perf keyword -p last_30_days
```

A launch creates the budget, campaign, geo and language targeting, ad groups,
keywords, and responsive search ads in **one atomic mutate**: it either lands
whole or not at all, so a failure cannot leave half a campaign behind. Every
write is validated server-side first, which is a genuine dry run rather than a
local guess.

Three house rules are hard-coded, because all three default the wrong way in the
UI and quietly waste B2B budget:

- **Search network only.** Display expansion and search partners off.
- **Physical presence only.** "US" means people in the US, not people anywhere
  who searched about it.
- **Manual CPC to start.** Smart bidding with no conversion history spends
  unpredictably. Switch in the UI once there is data.

### Setup

Google Ads needs two things LinkedIn does not:

1. **A developer token**, from a Google Ads **manager (MCC)** account at
   [ads.google.com/aw/apicenter](https://ads.google.com/aw/apicenter). A plain
   client account cannot issue one. Approval usually lands on **Explorer** access
   automatically (2,880 production ops/day).

   **Explorer is not enough for `adwarp google keywords`.** Explorer blocks
   KeywordPlanService, so keyword research needs **Basic** access (15,000
   ops/day), which is a separate application on the same screen. Campaign
   creation and reporting work fine on Explorer.
2. **An OAuth client**, from a Google Cloud project with the Google Ads API
   enabled. Use the "Desktop app" type, which accepts any `localhost` redirect.

   For the consent screen, **do not leave it in "Testing"**. That status issues
   refresh tokens that stop working after 7 days. Beyond that it is a trade:

   - **Internal** (Workspace orgs only) is what Google's OAuth docs recommend for
     a single-company tool. Simplest, no verification, no 7-day expiry.
   - **External + In production** is the precondition for *brand verification*,
     the pilot that cuts Basic Access review from days to hours. The cost is that
     `auth/adwords` is a **sensitive** scope, so a published external app can
     require full OAuth app verification, potentially slower than the wait it
     saves.

   Internal is the better default for an internal tool. Choose External only if
   the fast track is worth the verification risk.

Then write `~/.adwarp/google.json`:

```json
{
  "clientId": "....apps.googleusercontent.com",
  "clientSecret": "...",
  "developerToken": "...",
  "loginCustomerId": "1234567890",
  "defaultCustomerId": "0987654321",
  "defaultConversionActionNames": ["Demo Booked"]
}
```

`loginCustomerId` is the manager account and is only needed when you reach the
target account through one. Run `adwarp google auth login` and you are set.
[Set up Google Ads](https://adwarp.dev/docs/google-ads-setup) in the docs has the same
steps, plus the `ADWARP_GOOGLE_*` environment variables.

## Packages

- `@adwarp/shared`: the platform-neutral layer: OAuth, credential stores, retry policy, the change journal, period and KPI math.
- `@adwarp/core`: LinkedIn REST client, resource modules, CSV + SHA256 hashing, Salesforce and HubSpot readers.
- `@adwarp/google`: Google Ads REST client, GAQL reads, atomic mutate builder, Search campaign creation.
- `@adwarp/mcp`: MCP server (stdio for local; reused by the hosted app). **Primary interface.**
- `@adwarp/cli`: the `adwarp` CLI over the same engines, for scripted batch runs.
- `@adwarp/web`: Next.js app that hosts the MCP over HTTP on Vercel, at `https://mcp.adwarp.dev/api/mcp`. It serves no pages: its other paths redirect to adwarp.dev.
- `adwarp`: the published npm package. Bundles the CLI and the MCP server behind the `adwarp`, `adwarp-mcp` and `liam` commands.

## How it works

Both interfaces are thin layers over the same engine. Every MCP tool and CLI command builds
a client via `createLinkedInAds()` (`core/src/client.ts`), which loads config plus an
auto-refreshing OAuth token provider, then calls a typed resource module
(`campaigns.ts`, `audience.ts`, `report.ts`, ...) that wraps LinkedIn's versioned REST API
(`LinkedIn-Version` pinned in config). Input shapes live as zod schemas in
`core/src/schemas.ts` and are reused verbatim as the MCP tool input schemas, so the CLI and
MCP can never drift apart.

The drafts-first safety rule is enforced at creation: campaign groups, campaigns, and
creatives default to `DRAFT` status, and going live is always an explicit request (a
`status` of `ACTIVE`, `campaigns update --status ACTIVE --apply`, or `ad resume --apply`). On Google, no
create schema can express an enabled status at all. Every write also passes through one HTTP chokepoint that appends to a
local change journal (`~/.adwarp/changelog.jsonl`) for later lift analysis.

[AGENTS.md](./AGENTS.md) has the full architecture notes and the LinkedIn API gotchas
(restli encoding, required fields, DMP audience flow) learned from live testing.

## Install

The [install guide](https://adwarp.dev/docs/install) on adwarp.dev has these steps too, with
a setup page for each client: [Claude Code](https://adwarp.dev/docs/clients/claude-code),
[Claude Desktop](https://adwarp.dev/docs/clients/claude-desktop),
[Cursor](https://adwarp.dev/docs/clients/cursor), [Codex](https://adwarp.dev/docs/clients/codex)
and the [CLI](https://adwarp.dev/docs/clients/cli).

There are two ways to install Adwarp:

1. **[As an MCP server](#option-1-install-as-an-mcp-server)**, registered with Claude
   Code, Claude Desktop, Cursor, Codex, or other MCP clients that can run a local server,
   so you create campaigns by talking
   to your assistant. Run it locally, or skip the always-on install entirely and
   [connect to the hosted endpoint with your own credentials](#hosted-mcp-connect-with-your-own-credentials-nothing-to-deploy).
2. **[As a terminal CLI](#option-2-install-the-terminal-cli)**, a global `adwarp` command
   for running everything from your terminal, scripts, or cron.

Both run against **your own LinkedIn developer app**, so your credentials and your ad
account stay yours. Both come from the same npm package, `adwarp`. The first two steps
are shared: create a LinkedIn app (step 0) and authenticate (step 1). After that, pick
your path, or do both; they read the same `~/.adwarp` credentials.

### Step 0: create a LinkedIn app (once)

1. Create an app at https://www.linkedin.com/developers/apps. It must be associated
   with your company's LinkedIn Page.
2. On the **Products** tab, request access:

   | Product | Needed for | Required? |
   | --- | --- | --- |
   | Advertising API | campaigns, ads, targeting, reporting, conversions | **Yes** |
   | Audiences | uploading CSV contact/company lists as matched audiences | Only for audience upload |
   | LinkedIn Ad Library | competitor ad metadata via the official API | Required for competitor discovery; no browser fallback |

3. On the **Auth** tab, add `http://localhost:53682/callback` as an authorized redirect
   URL, and note your **Client ID** and **Client Secret**.
4. Once the Advertising API is approved, map your ad account under
   **Products → Advertising API → View Ad Accounts**. Skip this and `accounts list`
   comes back empty.

**OAuth scopes.** `adwarp auth login` requests `rw_ads` (create and edit campaigns),
`r_ads_reporting` (reporting), `rw_conversions` (conversion tracking), and
`w_organization_social` (image ads create a post owned by your LinkedIn Page). If you add
a product or scope later, run `auth login` again; a token refresh keeps only the scopes
you originally granted.

### Step 1: authenticate (once, both paths)

Requires Node.js 20+.

```bash
# App credentials (alternatively set ADWARP_LINKEDIN_CLIENT_ID / ADWARP_LINKEDIN_CLIENT_SECRET env vars)
mkdir -p ~/.adwarp
echo '{ "clientId": "...", "clientSecret": "...", "linkedinVersion": "202605" }' > ~/.adwarp/config.json

npx -y adwarp auth login      # opens the browser; tokens land in ~/.adwarp
npx -y adwarp accounts list   # verify, then set defaultAccountId in config.json
```

### Option 1: install as an MCP server

Register the server with your MCP client; it reads the `~/.adwarp` credentials from step 1.

**Claude Code**

```bash
claude mcp add adwarp -- npx -y adwarp mcp
```

**Claude Desktop, Cursor, or other MCP clients that can run a local server**, in the client's MCP config JSON:

```json
{
  "mcpServers": {
    "adwarp": { "command": "npx", "args": ["-y", "adwarp", "mcp"] }
  }
}
```

`adwarp mcp` and the `adwarp-mcp` command start the same server. Prefer Docker? The root
`Dockerfile` builds an image of the same server; see
[Run it in Docker](https://adwarp.dev/docs/install#run-it-in-docker).

Ask for something read-only to confirm it works: "List my ad accounts" or "How did my
account do in the last 30 days?"

#### Hosted MCP: connect with your own credentials, nothing to deploy

The hosted MCP server at

```
https://mcp.adwarp.dev/api/mcp
```

is **multi-tenant, bring-your-own-credentials**: you pass your LinkedIn developer app's
details as request headers, and every call runs against *your* app and *your* ad account.
The server holds no state for you: credentials are used in memory to call LinkedIn and
never logged or persisted. The original address, `https://liam-mcp.vercel.app/api/mcp`,
still works and serves the same endpoint, so existing connections need no change. The
[hosted endpoint docs](https://adwarp.dev/docs/hosted) have the full reference.

| Header | Value | Required? |
| --- | --- | --- |
| `X-Adwarp-Linkedin-Client-Id` | your LinkedIn app's Client ID | Yes |
| `X-Adwarp-Linkedin-Client-Secret` | your LinkedIn app's Client Secret | Yes |
| `X-Adwarp-Linkedin-Refresh-Token` | a refresh token from your `auth login` (~365d) | Yes |
| `X-Adwarp-Linkedin-Account-Id` | numeric ad account id used when a call omits one | No |
| `X-Adwarp-Linkedin-Version` | API version pin (YYYYMM), defaults to the server's | No |

Do step 0 and step 1 above once (the LinkedIn app and the local `auth login`; LinkedIn's
OAuth consent has to happen in your browser, so the token mint is the one local step).
Then print the ready-to-run connect command:

```bash
npx -y adwarp auth export --mcp
# claude mcp add --transport http adwarp https://mcp.adwarp.dev/api/mcp \
#   --header "X-Adwarp-Linkedin-Client-Id: …" \
#   --header "X-Adwarp-Linkedin-Client-Secret: …" \
#   --header "X-Adwarp-Linkedin-Refresh-Token: …" \
#   --header "X-Adwarp-Linkedin-Account-Id: …"
```

Other MCP clients that can send custom headers connect the same way (for clients without
native HTTP transport: `npx mcp-remote <url> --header "X-Adwarp-Linkedin-Client-Id: …" …`).
Verify with a read-only call ("list my ad accounts"), and from then on the connection is
just a URL plus headers, usable from machines that never cloned this repo.

Know the trade-off: your client secret and refresh token travel with every request to
that server, so only point them at a deployment you trust, or self-host the identical
endpoint (next section). The same scopes that manage ads can also switch them on,
so treat these credentials like an ad account password.

Hosted limitations (all by design, they need local resources): `upload_audience_csv`
reads a CSV path on the server, `audience_from_salesforce` needs your local `sf` CLI,
`audience_from_hubspot` is not registered there (its HubSpot token stays on your machine),
competitor-ads scraping falls back to API-only metadata (no browser), and the change
journal / lift tools need the local `~/.adwarp/changelog.jsonl`. Run those through the
local MCP server or CLI.

**Put a skill on top.** The clean split for teams: your MCP client's config holds the
credentials (the headers above), and a small skill or system prompt holds your playbook:
default ad account, naming conventions, standing exclusions, house rules like "audience
expansion always off". The [paid ads skills](https://github.com/adwarp-dev/paid-ads-skills) are working
examples; copy one, swap in your defaults, and your assistant drives the hosted tools with your
rules. Credentials never belong in a skill file.

#### Self-host the same endpoint on Vercel

Run your own instance so credentials never touch shared infrastructure, and so you also
get a private env-configured tenant:

1. Get your env values locally: `npx -y adwarp auth export`.
2. Deploy `apps/web` to Vercel (set the project **Root Directory** to `apps/web`).
3. In Vercel project settings, add the env vars that `auth export` printed
   (`ADWARP_LINKEDIN_CLIENT_ID`, `ADWARP_LINKEDIN_CLIENT_SECRET`, `ADWARP_LINKEDIN_REFRESH_TOKEN`, `ADWARP_LINKEDIN_VERSION`,
   and a strong `MCP_AUTH_TOKEN`). In Vercel's Deployment Protection settings, disable
   Vercel Authentication for production (or add a protection-bypass secret); otherwise
   MCP clients can't reach the endpoint.
4. Your MCP endpoint is `https://<your-app>.vercel.app/api/mcp`. Connect with the secret
   in the header:

```bash
claude mcp add --transport http adwarp https://<your-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Requests carrying `MCP_AUTH_TOKEN` use the env credentials (your tenant). Requests
carrying the `X-Adwarp-Linkedin-*` headers above use the caller's credentials instead, so one
self-hosted instance can serve your whole team, each member on their own LinkedIn app. The app
serves only the endpoint. Its other paths, such as `/` and `/docs`, redirect to adwarp.dev.

### Option 2: install the terminal CLI

Install the package globally for an `adwarp` command, or run any single command with
`npx -y adwarp <command>`:

```bash
npm install -g adwarp
adwarp accounts list
```

Coming from Liam? `liam` still works as an alias for `adwarp`: the package installs both
names, so existing scripts and cron jobs keep running.

A sensible first session:

```bash
adwarp targeting search titles "demand generation"   # resolve targeting URNs
adwarp report summary -p last_30_days                # account rollup + flags
adwarp launch --brief examples/brief.json            # creates DRAFTS only
```

The full [CLI reference](#cli-reference) is below.

### From source

For contributors, or to run changes that are not released yet. Requires git and pnpm too.

```bash
git clone https://github.com/adwarp-dev/adwarp.git
cd adwarp
pnpm install && pnpm -r build

node packages/cli/dist/index.js accounts list
claude mcp add adwarp -- node /abs/path/adwarp/packages/mcp/dist/index.js
```

### Or paste this prompt and let your assistant do the setup

Copy the whole block into Claude (or any capable assistant with terminal access) and it
will walk you through everything above, one step at a time:

```text
You are helping me set up Adwarp, an open-source LinkedIn Ad Manager from
https://github.com/adwarp-dev/adwarp. It runs locally as an MCP server and a CLI,
both from the npm package "adwarp".
Everything it creates on LinkedIn starts as a draft, so nothing spends money until I
explicitly turn it on.

Walk me through the setup one step at a time. Run commands for me where you can,
show me exactly what to click where you cannot, and wait for my confirmation
before moving to the next step.

1. Check that Node.js 20 or newer is installed. Help me install it if it is
   missing.
2. Help me create a LinkedIn developer app at
   https://www.linkedin.com/developers/apps (it must be associated with my
   company's LinkedIn Page):
   a. On the Products tab, request access to the "Advertising API" product.
      This is the only required product; approval can take a while.
   b. Optional: also request "Audiences" if I want to upload CSV contact or
      company lists as matched audiences.
   c. Optional: also request "LinkedIn Ad Library" if I want competitor ad
      metadata through the official API.
   d. On the Auth tab, add http://localhost:53682/callback as an authorized
      redirect URL, and show me where the Client ID and Client Secret live.
3. Create ~/.adwarp/config.json containing my clientId, clientSecret, and
   "linkedinVersion": "202605".
4. Run "npx -y adwarp auth login". My browser opens LinkedIn's
   consent screen; after I approve, tokens are stored in ~/.adwarp/credentials.json.
5. Verify with "npx -y adwarp accounts list". If no accounts
   show up, remind me to map my ad account in the Developer Portal under
   Products > Advertising API > View Ad Accounts. Then set my account id as
   "defaultAccountId" in ~/.adwarp/config.json.
6. Register the MCP server with the assistant I use:
   - Claude Code: claude mcp add adwarp -- npx -y adwarp mcp
   - Claude Desktop or another client: add {"command": "npx", "args":
     ["-y", "adwarp", "mcp"]} under mcpServers in its config.
7. Confirm the tools load, then show me one read-only call working, for example
   list_ad_accounts or a last_30_days performance summary.

If any step fails, show me the exact error and fix it with me before moving on.
```

## Skills

The 17 [paid ads skills](https://github.com/adwarp-dev/paid-ads-skills) turn Adwarp's
tools into playbooks: what to pull, how to judge it, the thresholds that matter, and a
report that ends in ranked actions. They also run from a CSV export with no Adwarp install.
Analysis skills only read; the ones that change an account create drafts or paused
entities after you confirm.

- **LinkedIn Ads:** account audit, performance review, spend analysis, lead drivers,
  pause rules, audience sizing, audience ops, ABM builder, guarded launch, Ad Library teardown
- **Google Ads:** account audit, search campaign builder, search terms
- **Both platforms:** weekly report, daily health check, experiment lift, budget pacing

```bash
npx skills add adwarp-dev/paid-ads-skills
```

The 11 `adwarp-*` skills that used to live in [`skills/`](./skills) moved there under new
names. Their folders now point to the new skills, so existing installs keep working. The
full list of moves is in the [skills docs](https://adwarp.dev/docs/skills).

## Tools (MCP)

The [tool reference](https://adwarp.dev/docs/tools) lists every tool with its inputs and
whether it works on the hosted endpoint.

- **Accounts:** `list_ad_accounts`
- **Targeting:** `list_targeting_facets`, `search_targeting` (typeahead a facet for entity URNs),
  `list_facet_entities`, `estimate_audience` (structured spec). Talk in plain language
  ("VPs of demand gen at SaaS companies in the US") and Adwarp resolves the facets and
  estimates reach before building the campaign.
- **Audiences:** `upload_audience_csv` (auto-cleans the CSV: normalizes column names, drops
  non-matcher columns, hashes emails, converts company domains to website URLs; supports both
  contact and company lists), `audience_from_salesforce` (SOQL to matched audience),
  `audience_from_hubspot` (HubSpot list or search to matched audience, local only), `get_audience_status`
- **Conversions:** `list_conversions` (select an existing insight-tag conversion to track).
  `create_campaign` and `launch_from_brief` accept `conversionIds` or `conversionName`, and
  fall back to `defaultConversionName` from config.
- **Campaigns:** `create_campaign_group`, `create_campaign`, `create_text_ad`, `create_image_ad`;
  `list_campaigns` (the account structure: campaign groups and their ad groups, **drafts
  included**, unlike reporting which only shows entities with spend), `list_ads`, `delete_ad`
  (removes the creative and best-effort its Direct Sponsored Content post), `update_ad`
  (pause, resume, or archive a single ad; `ACTIVE` starts spend, so it is set only on an
  explicit request). LinkedIn's editor ignores post edits on a live ad, so to change copy you
  recreate: `delete_ad` + `create_image_ad`.
- **Orchestrator:** `launch_from_brief` (audience + group + campaign + draft creatives in one call)
- **Reporting:** `performance_summary` (account rollup + top/bottom + flags), `get_performance`
  (per-entity KPIs at any level), `performance_trend` (weekly/monthly with deltas). KPIs: CTR,
  CPC, CPM, CPL, conversion rate, cost per conversion. Levels: campaign_group, campaign, creative.
- **Competitor intel:** `inspect_competitor_ads` uses the official Ad Library API for
  metadata and, in `auto` mode, an optional remote worker for creative copy and screenshots.
  No CLI or MCP code launches a local browser or falls back to scraping when the API fails.
  Supply both `advertiser` and `companyId` to filter broad API matches before queuing creatives.
  `api` mode is metadata only. `auto` queues at most 10 ads and returns cached results or job
  status; use `get_competitor_creatives` / `adwarp creative-status <ids>` to read completed jobs.
  The worker persists its cache, queue, rolling budgets and block state. See
  [Remote creative worker](services/creative-worker/README.md) for deployment and configuration.
- **Change journal & lift:** `log_ad_change` (record a change), `list_ad_changes`, `compute_lift`
  (before-vs-after performance for each recorded change). Adwarp auto-journals every change it makes;
  see [Change journal & lift](#change-journal--lift) below.

### Targeting spec

Structured targeting uses short facet names mapped to entity URNs (resolve URNs with
`search_targeting`). URNs within a facet are ORed; facets are ANDed; excluded facets are ORed.

```json
{ "include": { "locations": ["urn:li:geo:103644278"], "seniorities": ["urn:li:seniority:7"], "titles": ["urn:li:title:26587"] },
  "exclude": { "industries": ["urn:li:industry:47"] } }
```

## CLI reference

All commands also work via `npx -y adwarp <cmd>`. The [CLI docs](https://adwarp.dev/docs/cli)
have the full list, including the Google Ads commands.

```
adwarp auth login                         # OAuth, stores tokens in ~/.adwarp
adwarp auth export                        # print env vars for a self-hosted (Vercel) server
adwarp auth export --mcp                  # print the hosted-MCP connect command with your headers
adwarp accounts list                      # list accessible ad accounts
adwarp targeting search <facet> <query>   # typeahead a facet for entity URNs
adwarp targeting estimate <facet> <urns…> # audience size for one facet's URNs
adwarp audience upload -n <name> -f <csv> # clean + upload a CSV as a matched audience
adwarp audience upload -n <name> -f <csv> --dry-run   # preview the cleaned CSV, no upload
adwarp audience from-salesforce -n <name> -q "<SOQL>"   # Salesforce query -> matched audience
adwarp audience from-hubspot -n <name> --list <id> [--dry-run]   # HubSpot list -> matched audience
adwarp audience from-hubspot -n <name> --filter <prop>:<op>:<value> [-t company]   # HubSpot search -> matched audience
adwarp audience status <segmentId>        # matching status + resolved size
adwarp conversions list                   # account conversions (pick one to track)
adwarp campaigns list [--group <id>] [--all]   # campaign groups + ad groups, drafts included
adwarp ad list <campaignId>               # ads in an ad group (id, status, name), drafts included
adwarp ad delete <creativeId>             # delete an ad (creative + its DSC post)
adwarp ad pause <creativeId> [--apply]    # pause a single ad, previews unless --apply
adwarp ad resume <creativeId> [--apply]   # set an ad ACTIVE again (starts spend), previews unless --apply
adwarp ad archive <creativeId> [--apply]  # archive an ad, previews unless --apply
adwarp report summary [-p <period>]       # account rollup: totals, top performers, flags
adwarp report perf <level> [--parent <id>] # per-entity KPI rows
adwarp report trend <level> <id> [-b weekly|monthly]  # trend with deltas
adwarp launch --brief <brief.json>        # audience + group + campaign + draft creatives
adwarp competitor ads <advertiser>        # any company's ads from the public Ad Library
                                        #   <advertiser> = name, company id, or company URL
                                        #   -k <keyword> -c <countries> -e auto|api -m <max> --json
                                        #   --company-id <id> --copy-max <n> (remote sample, max 10)
adwarp changelog list [-t <type>] [-i <id>]           # recorded ad changes, newest first
adwarp changelog add -t <type> -i <id> -f <field> --after <v> [-l <label>]   # log a change made elsewhere
adwarp lift <level> <id> [-w <days>]      # before-vs-after performance for each recorded change
```

Periods: `last_7_days`, `last_30_days`, `last_90_days`, `month_to_date`, `last_month`.

`--account` defaults to `defaultAccountId` from config where applicable.

## Change journal & lift

Adwarp keeps an append-only journal of every change made to an ad entity so you can measure the
**lift** of a change: how performance differed in the window before it versus after.

- **Where it lives:** `~/.adwarp/changelog.jsonl` (one JSON object per line). A plain local
  file with nothing to set up. Override the path with `ADWARP_CHANGELOG_PATH`.
- **Auto-capture:** every create/update Adwarp makes to a campaign group, campaign, or creative is
  journaled automatically (captured at the one HTTP chokepoint, so it can't be forgotten).
- **Manual entries:** log changes made outside Adwarp (e.g. in Campaign Manager), or attach a
  hypothesis, with `adwarp changelog add` / the `log_ad_change` tool. Use `-l/--label` to name the
  test (e.g. `"outcome-led headline test"`) and `--tags` to group related changes.
- **Lift:** `adwarp lift <level> <entityId>` (or `compute_lift`) reads the journal for that entity
  and, for each change, compares the `--window` days before (default 14) against the same window
  after, reporting before/after KPIs and per-metric deltas (CTR, CPC, conversion rate,
  cost-per-conversion, …). Recent changes get a clamped, `partial` after-window.

This is a **directional pre/post comparison, not a controlled experiment**. It is confounded by
seasonality, the LinkedIn learning phase after an edit, and any concurrent budget change, so treat
the deltas as a signal. Set `ADWARP_NO_CHANGELOG=1` to disable auto-capture; journaling is
also off on hosted deploys (read-only filesystem).

## Configuration

Local config lives in `~/.adwarp/config.json` (mode 0600, never in the repo):

| Field | Purpose |
| --- | --- |
| `clientId`, `clientSecret` | LinkedIn app credentials (or `ADWARP_LINKEDIN_CLIENT_ID`/`ADWARP_LINKEDIN_CLIENT_SECRET`) |
| `linkedinVersion` | Pinned API version, e.g. `202605` |
| `defaultAccountId` | Ad account used when a command/brief omits one |
| `defaultConversionName` | Conversion auto-selected for new campaigns when none is given |
| `mcpAuthToken` | Bearer secret for the hosted MCP endpoint |

Hosted equivalents are the `ADWARP_LINKEDIN_*` env vars plus `MCP_AUTH_TOKEN` (see [Configuration](https://adwarp.dev/docs/config)).
OAuth tokens are stored separately in `~/.adwarp/credentials.json`. A HubSpot private app
token, for [HubSpot audiences](https://adwarp.dev/docs/hubspot), goes in `~/.adwarp/hubspot.json` (mode 0600)
or `ADWARP_HUBSPOT_TOKEN`.

Coming from Liam? Every name from before the rename still works: the `~/.liads` folder, the
`LIADS_*` and `GADS_*` variables, and the `X-Liads-*` headers. See
[Names from before the rename](https://adwarp.dev/docs/config#names-from-before-the-rename).

## Salesforce integration

Adwarp reads Salesforce by shelling out to the authenticated `sf` CLI (`sf data query`), so it
reuses your existing login and needs no new credentials. `audience_from_salesforce` (and
`adwarp audience from-salesforce`) take a SOQL query that selects an email column and turn the
result into a matched audience, closing the loop from "accounts flagged in Salesforce" to
"LinkedIn targeting." Example:

```
adwarp audience from-salesforce -n "Q3 target accounts" \
  -q "SELECT Email FROM Contact WHERE Account.Target_List__c = true AND Email != null"
```

## HubSpot integration

Adwarp reads HubSpot with a private app access token you create in your own HubSpot account,
with 3 read-only scopes: `crm.objects.contacts.read`, `crm.objects.companies.read` and
`crm.lists.read`. Put the token in `~/.adwarp/hubspot.json` as `{ "accessToken": "..." }`
(mode 0600) or in `ADWARP_HUBSPOT_TOKEN`. `audience_from_hubspot` (and
`adwarp audience from-hubspot`) take a HubSpot list id or CRM search filters, read every
page, and turn the contacts or companies into a matched audience through the same cleaning
and hashing as a CSV upload, so only email hashes leave your machine. It runs locally only.
Example:

```
adwarp audience from-hubspot -n "Q3 target accounts" --list 123 --dry-run
adwarp audience from-hubspot -n "Marketing qualified leads" --filter lifecyclestage:EQ:marketingqualifiedlead
```

See [HubSpot audiences](https://adwarp.dev/docs/hubspot) for creating the private app and the limits.

## Safety

- Every campaign/creative is created **DRAFT/PAUSED**. Activation is a separate, explicit step.
- Matched-audience matching takes up to 48h, and a campaign needs ~300 matched members to serve.
- LinkedIn does not expose person-level ad-view data; cross-referencing is account/segment-level.
- Secrets never enter the repo. Local: `~/.adwarp`. Hosted: Vercel env vars.

## Docs

The docs are at [adwarp.dev/docs](https://adwarp.dev/docs):
[Install](https://adwarp.dev/docs/install),
[Create a LinkedIn app](https://adwarp.dev/docs/linkedin-app),
[Hosted endpoint](https://adwarp.dev/docs/hosted), [Tools](https://adwarp.dev/docs/tools),
[Skills](https://adwarp.dev/docs/skills), [CLI](https://adwarp.dev/docs/cli),
[Change journal](https://adwarp.dev/docs/journal), [Safety](https://adwarp.dev/docs/safety)
and [Configuration](https://adwarp.dev/docs/config).

Their source is [`docs/`](./docs) in this repo, as plain Markdown, 1 file per topic, each
with `title`, `description`, and `order` front matter. The website reads those files from
`main`, so edit them when behavior changes. Links between doc files stay relative
(`./install.md`), and the website turns them into its own page links.

[`docs/tools.json`](./docs/tools.json) lists every MCP tool with its description, input
schema, platform (`linkedin` or `google`), and whether it works on the hosted endpoint
(`hosted`, `hostedSupport` and `hostedNote`). It is
generated from the real tool registration code, so never edit it by hand. After adding,
removing, or changing a tool (including its zod input schema), run:

```bash
pnpm gen:tools   # builds @adwarp/mcp and its dependencies, then rewrites docs/tools.json
```

and commit the result. CI runs the same command and fails if `docs/tools.json` changes.

## License

MIT
