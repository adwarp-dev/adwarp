---
title: Configuration
description: "The local config file, where OAuth tokens live, the environment variables a hosted deploy uses instead, and the names from before the rename that still work."
order: 10
---

Local config lives in `~/.adwarp/config.json` (mode 0600, never in the repo). OAuth tokens are stored separately in `~/.adwarp/credentials.json`.

| Field | Purpose |
| --- | --- |
| `clientId`, `clientSecret` | LinkedIn app credentials (or the `ADWARP_LINKEDIN_CLIENT_ID` and `ADWARP_LINKEDIN_CLIENT_SECRET` environment variables) |
| `linkedinVersion` | pinned API version, for example `202605` |
| `defaultAccountId` | ad account used when a command or brief omits one |
| `defaultConversionName` | conversion auto-selected for new campaigns when none is given |
| `defaultConversionNames` | a list of conversions auto-selected for new campaigns, which takes precedence over `defaultConversionName` |

Google Ads has its own files in the same folder: `~/.adwarp/google.json` and `~/.adwarp/google-credentials.json`. See [Google Ads](./google-ads.md).

## Hosted equivalents

A hosted deploy reads environment variables instead of files:

| Variable | Purpose |
| --- | --- |
| `ADWARP_LINKEDIN_CLIENT_ID`, `ADWARP_LINKEDIN_CLIENT_SECRET` | LinkedIn app credentials |
| `ADWARP_LINKEDIN_REFRESH_TOKEN` | refresh token from a local `adwarp auth login` |
| `ADWARP_LINKEDIN_VERSION` | pinned API version |
| `ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID` | ad account used when a call omits one |
| `MCP_AUTH_TOKEN` | bearer secret that gates the environment-credential tenant |

`adwarp auth export` prints the `ADWARP_LINKEDIN_*` values from your local login. Callers can also bring their own credentials as `X-Adwarp-Linkedin-*` request headers. See [Hosted endpoint](./hosted.md).

## Other environment variables

| Variable | Purpose |
| --- | --- |
| `ADWARP_CHANGELOG_PATH` | override the change journal path |
| `ADWARP_NO_CHANGELOG` | set to `1` to turn off change journal auto-capture |
| `ADWARP_CREATIVE_WORKER_URL`, `ADWARP_CREATIVE_WORKER_TOKEN` | the [remote creative worker](https://github.com/adwarp-dev/adwarp/tree/main/services/creative-worker) for competitor ad copy |

Google Ads settings use `ADWARP_GOOGLE_*` variables, listed in [Google Ads environment variables](./google-ads.md#environment-variables).

## Names from before the rename

Adwarp used to be called Liam, and its internal names used `liads` and `gads`. Every old name still works, so an existing install, deploy, script or hosted connection needs no change. When both an old and a new name are set, the new one wins.

| Now | Still accepted |
| --- | --- |
| `~/.adwarp` folder | `~/.liads`, used until `~/.adwarp` holds a config or login of its own |
| `adwarp` command | `liam` |
| `adwarp-mcp` command | `liads-mcp`, when running from a clone |
| `ADWARP_LINKEDIN_CLIENT_ID`, `ADWARP_LINKEDIN_CLIENT_SECRET` | `LIADS_CLIENT_ID`, `LIADS_CLIENT_SECRET` |
| `ADWARP_LINKEDIN_REFRESH_TOKEN` | `LIADS_REFRESH_TOKEN` |
| `ADWARP_LINKEDIN_VERSION` | `LIADS_LINKEDIN_VERSION` |
| `ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID` | `LIADS_DEFAULT_ACCOUNT_ID` |
| `ADWARP_GOOGLE_CLIENT_ID`, `ADWARP_GOOGLE_CLIENT_SECRET` | `GADS_CLIENT_ID`, `GADS_CLIENT_SECRET` |
| `ADWARP_GOOGLE_DEVELOPER_TOKEN` | `GADS_DEVELOPER_TOKEN` |
| `ADWARP_GOOGLE_REFRESH_TOKEN` | `GADS_REFRESH_TOKEN` |
| `ADWARP_GOOGLE_LOGIN_CUSTOMER_ID`, `ADWARP_GOOGLE_DEFAULT_CUSTOMER_ID` | `GADS_LOGIN_CUSTOMER_ID`, `GADS_DEFAULT_CUSTOMER_ID` |
| `ADWARP_GOOGLE_API_VERSION` | `GADS_API_VERSION` |
| `ADWARP_CHANGELOG_PATH`, `ADWARP_NO_CHANGELOG` | `LIADS_CHANGELOG_PATH`, `LIADS_NO_CHANGELOG` |
| `ADWARP_CREATIVE_WORKER_URL`, `ADWARP_CREATIVE_WORKER_TOKEN` | `LIADS_CREATIVE_WORKER_URL`, `LIADS_CREATIVE_WORKER_TOKEN` |
| `X-Adwarp-Linkedin-Client-Id`, `X-Adwarp-Linkedin-Client-Secret` headers | `X-Liads-Client-Id`, `X-Liads-Client-Secret` |
| `X-Adwarp-Linkedin-Refresh-Token` header | `X-Liads-Refresh-Token` |
| `X-Adwarp-Linkedin-Account-Id` header | `X-Liads-Account-Id` |
| `X-Adwarp-Linkedin-Version` header | `X-Liads-Linkedin-Version` |

To move an existing install to the new folder, rename it: `mv ~/.liads ~/.adwarp`. Change journal entries written before the rename say `"source": "liam"` and read the same as `"adwarp"`.
