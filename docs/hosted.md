---
title: Hosted endpoint
description: "Connect to the hosted MCP endpoint with your own LinkedIn credentials as request headers, or self-host the same endpoint on Vercel."
order: 4
---

The hosted MCP server lives at:

```
https://mcp.adwarp.dev/api/mcp
```

It is multi-tenant and bring-your-own-credentials. You pass your LinkedIn developer app's details as request headers, and every call runs against your app and your ad account. The server holds no state for you. Credentials are used in memory to call LinkedIn and are never logged or persisted.

The original address, `https://liam-mcp.vercel.app/api/mcp`, still works and serves the same endpoint, so existing connections need no change.

## Headers

| Header | Value | Required? |
| --- | --- | --- |
| `X-Liads-Client-Id` | your LinkedIn app's Client ID | Yes |
| `X-Liads-Client-Secret` | your LinkedIn app's Client Secret | Yes |
| `X-Liads-Refresh-Token` | a refresh token from your `auth login` (valid for about 365 days) | Yes |
| `X-Liads-Account-Id` | numeric ad account id used when a call omits one | No |
| `X-Liads-Linkedin-Version` | API version pin (YYYYMM), defaults to the server's | No |

## Connect

Do the [LinkedIn app setup](./linkedin-app.md) and the [authenticate step](./install.md#authenticate) once. LinkedIn's OAuth consent has to happen in your browser, so minting the token is the only local step. Then print the ready-to-run connect command:

```bash
npx -y adwarp auth export --mcp
# claude mcp add --transport http adwarp https://mcp.adwarp.dev/api/mcp \
#   --header "X-Liads-Client-Id: ..." \
#   --header "X-Liads-Client-Secret: ..." \
#   --header "X-Liads-Refresh-Token: ..." \
#   --header "X-Liads-Account-Id: ..."
```

Any MCP client that supports custom headers works the same way. For clients without native HTTP transport, use `npx mcp-remote <url> --header "X-Liads-Client-Id: ..."` and so on. Verify with a read-only call ("list my ad accounts"). From then on the connection is just a URL plus headers, usable from machines that never cloned the repo.

Know the trade-off: your client secret and refresh token travel with every request to that server, so only point them at a deployment you trust, or self-host the identical endpoint (below). The same scopes that manage ads can also switch them on, so treat these credentials like an ad account password.

## Hosted limitations

These are by design, because they need local resources. Run them through the [local MCP server](./install.md) or the [CLI](./cli.md) instead.

- `upload_audience_csv` reads a CSV path on the server, not on your machine.
- `audience_from_salesforce` needs your local `sf` CLI.
- `inspect_competitor_ads` returns Ad Library metadata only, unless the server is configured with the [remote creative worker](https://github.com/adwarp-dev/adwarp/tree/main/services/creative-worker). Nothing launches a browser.
- The change journal and lift tools (`log_ad_change`, `list_ad_changes`, `compute_lift`) need the local `~/.liads/changelog.jsonl`. Journaling is off on hosted deploys, which have a read-only filesystem.
- The Google Ads `gads_*` tools are not registered on the hosted endpoint at all. It serves many callers, each with their own LinkedIn credentials, while Google credentials would come from shared server environment variables. Exposing them would let any caller operate the server's Google Ads account.

[tools.json](./tools.json) marks every tool with `hosted: true` or `hosted: false`.

## Put a skill on top

The clean split for teams: your MCP client's config holds the credentials (the headers above), and a small skill or system prompt holds your playbook: default ad account, naming conventions, standing exclusions, and house rules like "audience expansion always off". The [skills folder](https://github.com/adwarp-dev/adwarp/tree/main/skills) in the repo is a working example. Copy one, swap in your defaults, and your assistant drives the hosted tools with your rules. Credentials never belong in a skill file. See [Skills](./skills.md).

## Self-host on Vercel

Run your own instance so credentials never touch shared infrastructure, and so you also get a private, environment-configured tenant.

1. Get your environment values locally: `npx -y adwarp auth export`.
2. Deploy `apps/web` to Vercel, with the project Root Directory set to `apps/web`.
3. In the Vercel project settings, add the environment variables that `auth export` printed (`LIADS_CLIENT_ID`, `LIADS_CLIENT_SECRET`, `LIADS_REFRESH_TOKEN`, `LIADS_LINKEDIN_VERSION`) plus a strong `MCP_AUTH_TOKEN`. In the Deployment Protection settings, disable Vercel Authentication for production (or add a protection-bypass secret), otherwise MCP clients cannot reach the endpoint.
4. Your MCP endpoint is `https://<your-app>.vercel.app/api/mcp`. Connect with the secret in the header:

```bash
claude mcp add --transport http adwarp https://<your-app>.vercel.app/api/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

Requests carrying `MCP_AUTH_TOKEN` use the environment credentials (your tenant). Requests carrying the `X-Liads-*` headers use the caller's credentials instead, so a single self-hosted instance can serve your whole team, each member on their own LinkedIn app.
