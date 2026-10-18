---
title: Configuration
description: "The local config file, where OAuth tokens live, and the environment variables a hosted deploy uses instead."
order: 10
---

Local config lives in `~/.liads/config.json` (mode 0600, never in the repo). OAuth tokens are stored separately in `~/.liads/credentials.json`.

| Field | Purpose |
| --- | --- |
| `clientId`, `clientSecret` | LinkedIn app credentials (or the `LIADS_CLIENT_ID` and `LIADS_CLIENT_SECRET` environment variables) |
| `linkedinVersion` | pinned API version, for example `202605` |
| `defaultAccountId` | ad account used when a command or brief omits one |
| `defaultConversionName` | conversion auto-selected for new campaigns when none is given |
| `defaultConversionNames` | a list of conversions auto-selected for new campaigns, which takes precedence over `defaultConversionName` |

Google Ads has its own files in the same folder: `~/.liads/google.json` and `~/.liads/google-credentials.json`. See [Google Ads](./google-ads.md).

## Hosted equivalents

A hosted deploy reads environment variables instead of files:

| Variable | Purpose |
| --- | --- |
| `LIADS_CLIENT_ID`, `LIADS_CLIENT_SECRET` | LinkedIn app credentials |
| `LIADS_REFRESH_TOKEN` | refresh token from a local `adwarp auth login` |
| `LIADS_LINKEDIN_VERSION` | pinned API version |
| `LIADS_DEFAULT_ACCOUNT_ID` | ad account used when a call omits one |
| `MCP_AUTH_TOKEN` | bearer secret that gates the environment-credential tenant |

`adwarp auth export` prints the `LIADS_*` values from your local login. Callers can also bring their own credentials as `X-Liads-*` request headers. See [Hosted endpoint](./hosted.md).

## Other environment variables

| Variable | Purpose |
| --- | --- |
| `LIADS_CHANGELOG_PATH` | override the change journal path |
| `LIADS_NO_CHANGELOG` | set to `1` to turn off change journal auto-capture |
| `LIADS_CREATIVE_WORKER_URL`, `LIADS_CREATIVE_WORKER_TOKEN` | the [remote creative worker](https://github.com/adwarp-dev/adwarp/tree/main/services/creative-worker) for competitor ad copy |
