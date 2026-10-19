---
title: MCP tools
description: "Every tool the Adwarp MCP server exposes, grouped by area, plus the structured targeting spec."
order: 5
---

The MCP server exposes the tools below. [tools.json](./tools.json) is the complete, generated list: every tool's name, description, input JSON Schema, platform (`linkedin` or `google`), and whether it works on the hosted endpoint (`hosted`, `hostedSupport` and `hostedNote`, as in [Hosted limitations](./hosted.md#hosted-limitations)). It is built from the server's own registration code with `pnpm gen:tools`, and CI fails when it drifts.

## Accounts

- `list_ad_accounts`: the LinkedIn ad accounts your app can access.

## Targeting

- `list_targeting_facets`: the facets you can target on, by short name.
- `search_targeting`: typeahead a facet for entity URNs.
- `list_facet_entities`: every entity of a small facet, such as seniorities.
- `estimate_audience`: audience size for a structured targeting spec.

Talk in plain language ("VPs of demand gen at SaaS companies in the US") and Adwarp resolves the facets and estimates reach before building the campaign.

## Audiences

- `upload_audience_csv`: cleans a CSV and uploads it as a matched audience. It normalizes column names, drops non-matcher columns, hashes emails, and converts company domains to website URLs. Contact and company lists are both supported.
- `audience_from_salesforce`: a SOQL query to a matched audience. See [Salesforce](./salesforce.md).
- `audience_from_hubspot`: a HubSpot list, or a CRM search by property filters, to a matched audience of contacts or companies. Pass `dryRun` first to see the counts and a masked sample. Local only. See [HubSpot](./hubspot.md).
- `get_audience_status`: matching status and resolved size.

## Conversions

- `list_conversions`: the account's existing insight-tag conversions, to select one to track.

`create_campaign` and `launch_from_brief` accept `conversionIds` or `conversionName`, and fall back to the default conversion in [config](./config.md).

## Campaigns

- `create_campaign_group`, `create_campaign`: create the LinkedIn campaign group and campaign (the ad group), as drafts.
- `update_campaign`: change an existing campaign (the ad group) in place: targeting, name, status, budget, bid, bidding strategy, schedule, or ad rotation. Pass `dryRun` first to preview the patch.
- `create_text_ad`, `create_image_ad`: create draft ads.
- `list_campaigns`: the account structure, campaign groups and their ad groups, with drafts included, unlike reporting, which only shows entities with spend.
- `list_ads`: the ads in an ad group, drafts included.
- `delete_ad`: removes the creative and, best effort, its Direct Sponsored Content post.
- `update_ad`: pauses, resumes, or archives a single ad by setting its `status` to `PAUSED`, `ACTIVE`, or `ARCHIVED`, without touching the rest of its ad group. Setting `ACTIVE` starts spend, so the assistant sets it only when you explicitly ask. An `ACTIVE` ad serves only while its ad group is active, and LinkedIn refuses to pause an ad that is still in review. Pass `dryRun` first to preview the patch.

LinkedIn's editor ignores post edits on a live ad, so to change copy you recreate it: `delete_ad` plus `create_image_ad`.

## Orchestrator

- `launch_from_brief`: audience, campaign group, campaign, and draft ads in a single call.

## Reporting

- `performance_summary`: an account rollup with top and bottom performers and flags.
- `get_performance`: per-entity metrics at any level.
- `performance_trend`: weekly or monthly trend with deltas.

Metrics: click-through rate, cost per click, cost per 1,000 impressions, cost per lead, conversion rate, and cost per conversion. Levels: `campaign_group`, `campaign`, `creative`.

## Competitor intel

- `inspect_competitor_ads`: discovers any company's ads through the official LinkedIn Ad Library API. In `api` mode it returns metadata only. In `auto` mode it also queues at most 10 ads on the optional [remote creative worker](https://github.com/adwarp-dev/adwarp/tree/main/services/creative-worker) for creative copy and screenshots, and returns cached results or job status. Supply both `advertiser` and `companyId` to filter broad name matches before creatives are queued.
- `get_competitor_creatives`: reads completed remote creative jobs by ad id, without queuing new work.

No CLI command or MCP tool launches a local browser or falls back to scraping when the API fails.

## Change journal

- `log_ad_change`: record a change made elsewhere, or attach a hypothesis.
- `list_ad_changes`: recorded changes, newest first.
- `compute_lift`: before and after performance for each recorded change.

Adwarp journals every change it makes on its own. See [Change journal and lift](./journal.md).

## Google Ads

Registered by the local server only, never by the hosted endpoint. See [Google Ads](./google-ads.md).

- `gads_list_accounts`: every Google Ads customer the login can reach. Run it first to prove the setup works.
- `gads_list_client_accounts`: the client accounts under a manager (MCC) account.
- `gads_keyword_ideas`: search volume, competition, and top-of-page bid range for seed terms or a landing page.
- `gads_list_campaigns`: campaigns with their ad groups, paused campaigns included.
- `gads_list_ads`: the ads in an ad group, with their responsive search copy.
- `gads_list_conversion_actions`: conversion actions on the account, so a launch can name one.
- `gads_launch_search_campaign`: a paused Search campaign from a brief, in a single atomic mutate. It validates without creating anything unless told otherwise.
- `gads_performance`: performance rows at campaign, ad group, ad, keyword, or search term level.
- `gads_search`: a raw, read-only GAQL query.

## Targeting spec

Structured targeting uses short facet names mapped to entity URNs. Resolve the URNs with `search_targeting`. URNs within a facet are ORed, facets are ANDed, and excluded facets are ORed.

```json
{ "include": { "locations": ["urn:li:geo:103644278"], "seniorities": ["urn:li:seniority:7"], "titles": ["urn:li:title:26587"] },
  "exclude": { "industries": ["urn:li:industry:47"] } }
```
