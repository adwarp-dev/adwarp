---
title: Google Ads
description: "Create paused Google Ads Search campaigns, research keywords, and report on performance. Setup for Google Ads API access and the OAuth client."
order: 7
---

Google Ads support covers Search campaigns only, creation first. It runs from the CLI under `adwarp google` and from the local MCP server as the `gads_*` tools. The hosted endpoint does not register the Google tools (see [Hosted endpoint](./hosted.md#hosted-limitations)).

```bash
adwarp google auth login
adwarp google accounts list                       # proves the OAuth client and API access work
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

Google Ads needs a Google Cloud project with Google Ads API access and an OAuth client. You don't need a developer token. Google sunset developer tokens on September 9, 2026, and API access now belongs to the Google Cloud project that owns your OAuth client ([Google's developer token page](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)). Adwarp doesn't send one.

### API access for your Cloud project

1. In a Google Cloud project with billing set up, enable the Google Ads API. That gives the project Test access, which only reaches test accounts.
2. On the Google Ads API Overview page in Cloud Console, open Upgrade access level and apply for Explorer access. Google approves most applications automatically. Explorer allows 2,880 operations a day on production accounts, which covers campaign creation, structure reads and reporting.
3. For `adwarp google keywords`, apply for Basic access on the same page. Explorer blocks KeywordPlanIdeaService, and Basic allows 15,000 operations a day. Basic needs brand verification first (see the consent screen below).

The levels and their limits are on Google's [access levels page](https://developers.google.com/google-ads/api/docs/api-policy/access-levels). A project on a Free Trial or with suspended billing gets Explorer and Basic applications rejected.

### An OAuth client

Create it in the same Cloud project. Use the "Desktop app" type, which accepts any `localhost` redirect.

Do not leave the consent screen in "Testing". That status issues refresh tokens that stop working after 7 days. Which setting to pick depends on the access you need:

- For Basic access (keyword research), set the user type to External and the publishing status to In production, then complete brand verification on the Branding tab. Google's [brand verification guide](https://developers.google.com/google-ads/api/docs/api-policy/brand-verification) requires this for Basic, even where other Google docs say Internal apps skip verification.
- For Explorer only, Internal (Google Workspace organizations only) also works and needs no verification.

`auth/adwords` is a sensitive scope, so until Google verifies the app, signing in shows an unverified app warning. You can continue past it for your own account.

### If you set Adwarp up before September 9, 2026

Your developer token's access level moved to the Cloud projects that called the API with it in the 90 days before the sunset. Check the level on the Google Ads API Overview page. You can delete `developerToken` from `google.json`. Adwarp ignores it and no longer sends the header, which Google says a future API version will reject.

### Configure and log in

Write `~/.adwarp/google.json`:

```json
{
  "clientId": "....apps.googleusercontent.com",
  "clientSecret": "...",
  "loginCustomerId": "1234567890",
  "defaultCustomerId": "0987654321",
  "defaultConversionActionNames": ["Demo Booked"]
}
```

`loginCustomerId` is the manager account, and is only needed when you reach the target account through one. You don't need a manager account to get API access. Run `adwarp google auth login` and you are set.

### Environment variables

For CI or a server, set these instead of writing `google.json`. When `ADWARP_GOOGLE_CLIENT_ID` and `ADWARP_GOOGLE_CLIENT_SECRET` are both set, Adwarp reads its Google settings from the environment only and ignores `google.json`.

| Variable | Replaces |
| --- | --- |
| `ADWARP_GOOGLE_CLIENT_ID`, `ADWARP_GOOGLE_CLIENT_SECRET` | `clientId`, `clientSecret` |
| `ADWARP_GOOGLE_LOGIN_CUSTOMER_ID` | `loginCustomerId` |
| `ADWARP_GOOGLE_DEFAULT_CUSTOMER_ID` | `defaultCustomerId` |
| `ADWARP_GOOGLE_API_VERSION` | `apiVersion`, the pinned Google Ads API version (default `v25`) |
| `ADWARP_GOOGLE_REFRESH_TOKEN` | the login in `~/.adwarp/google-credentials.json` |

`ADWARP_GOOGLE_REFRESH_TOKEN` works on its own too, next to a `google.json`. Setting it also turns off change journaling for Google writes. `defaultConversionActionNames` has no variable, so with environment settings a brief names its own conversion actions. The `GADS_*` names from before the rename still work; see [Configuration](./config.md#names-from-before-the-rename).

See the [CLI reference](./cli.md#google-ads-commands) for every Google command and [MCP tools](./tools.md#google-ads) for the `gads_*` tools.
