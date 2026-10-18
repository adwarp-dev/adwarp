---
title: Google Ads
description: "Create paused Google Ads Search campaigns, research keywords, and report on performance. Setup for the developer token and OAuth client."
order: 7
---

Google Ads support covers Search campaigns only, creation first. It runs from the CLI under `adwarp google` and from the local MCP server as the `gads_*` tools. The hosted endpoint does not register the Google tools (see [Hosted endpoint](./hosted.md#hosted-limitations)).

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

A launch creates the budget, campaign, geo and language targeting, ad groups, keywords, and responsive search ads in a single atomic mutate. It either lands whole or not at all, so a failure cannot leave half a campaign behind. Every write is validated server-side first, which makes the dry run a genuine check by Google rather than a local guess.

## House rules

Adwarp hard-codes 3 house rules, because all 3 default the wrong way in the Google Ads UI and quietly waste B2B budget:

- Search network only. Display expansion and search partners are off.
- Physical presence only. "US" means people in the US, not people anywhere who searched about it.
- Manual CPC to start. Smart bidding with no conversion history spends unpredictably. Switch in the UI once there is data.

Google has no draft status, so campaigns, ad groups, and ads are created paused, and no create schema can express any other status. Google campaigns can only be switched on in the Google Ads UI.

## Setup

Google Ads needs 2 things LinkedIn does not.

### A developer token

Get it from a Google Ads manager (MCC) account at [ads.google.com/aw/apicenter](https://ads.google.com/aw/apicenter). A plain client account cannot issue one. Approval usually lands on Explorer access automatically (2,880 production operations per day).

Explorer access is not enough for `adwarp google keywords`. Explorer blocks KeywordPlanService, so keyword research needs Basic access (15,000 operations per day), which is a separate application on the same screen. Campaign creation and reporting work fine on Explorer.

### An OAuth client

Create it in a Google Cloud project with the Google Ads API enabled. Use the "Desktop app" type, which accepts any `localhost` redirect.

Do not leave the consent screen in "Testing". That status issues refresh tokens that stop working after 7 days. Beyond that it is a trade-off:

- Internal (Google Workspace organizations only) is what Google's OAuth docs recommend for a single-company tool. It is the simplest, with no verification and no 7-day expiry.
- External and In production is the precondition for brand verification, the pilot that cuts Basic access review from days to hours. The cost is that `auth/adwords` is a sensitive scope, so a published external app can require full OAuth app verification, which may take longer than the wait it saves.

Internal is the better default for an internal tool. Choose External only if the fast track is worth the verification risk.

### Configure and log in

Write `~/.adwarp/google.json`:

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

`loginCustomerId` is the manager account, and is only needed when you reach the target account through one. Run `adwarp google auth login` and you are set.

See the [CLI reference](./cli.md#google-ads-commands) for every Google command and [MCP tools](./tools.md#google-ads) for the `gads_*` tools.
