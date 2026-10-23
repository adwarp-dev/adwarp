---
title: Grok Bot
description: "Connect xAI's Grok Bot to your own Adwarp endpoint with 1 header, then check that it works."
order: 21
---

Grok Bot, xAI's personal agent, runs on a cloud computer, so it can't start Adwarp on your machine or reach a server there. It connects over the internet to your own copy of the [hosted endpoint](./hosted.md) instead, and gets the LinkedIn tools that endpoint serves. The Google Ads tools need the local server, so they don't run in Grok yet.

[Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Deploy your endpoint

Grok Bot adds a custom MCP server with 1 header. The shared endpoint at `mcp.adwarp.dev` takes 3 credential headers, so deploy your own, which takes 1 `Authorization` header carrying your `MCP_AUTH_TOKEN`.

1. Print your LinkedIn values: `npx -y adwarp auth export`.
2. Make a token: `openssl rand -hex 32`.
3. Click [Deploy to Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fadwarp-dev%2Fadwarp&root-directory=apps%2Fweb&project-name=adwarp-mcp&repository-name=adwarp-mcp&env=ADWARP_LINKEDIN_CLIENT_ID,ADWARP_LINKEDIN_CLIENT_SECRET,ADWARP_LINKEDIN_REFRESH_TOKEN,MCP_AUTH_TOKEN&envDescription=LinkedIn%20app%20values%20from%20npx%20-y%20adwarp%20auth%20export%20and%20a%20long%20random%20MCP_AUTH_TOKEN%20that%20your%20AI%20app%20sends%20as%20a%20bearer%20token.&envLink=https%3A%2F%2Fadwarp.dev%2Fdocs%2Fhosted%23self-host-on-vercel). It copies this repo into your GitHub account, sets the Root Directory to `apps/web` and asks for these 4 values:

| Variable | Value |
| --- | --- |
| `ADWARP_LINKEDIN_CLIENT_ID` | from `auth export` |
| `ADWARP_LINKEDIN_CLIENT_SECRET` | from `auth export` |
| `ADWARP_LINKEDIN_REFRESH_TOKEN` | from `auth export` |
| `MCP_AUTH_TOKEN` | the token you made |

Your endpoint is `https://<your-app>.vercel.app/api/mcp`. If Vercel Authentication covers production in your team's Deployment Protection settings, turn it off for production, or Grok can't reach the endpoint. To set the project up by hand instead, follow [Self-host on Vercel](./hosted.md#self-host-on-vercel).

## Add it to your bot

Send your bot this message with your endpoint's URL. Say "custom MCP server", or the bot may look for a plugin in its catalog instead.

```
Add a custom MCP server called adwarp at https://<your-app>.vercel.app/api/mcp
```

When it asks for a key, give it the header:

| Field | Value |
| --- | --- |
| Header name | `Authorization` |
| Header value | `Bearer <MCP_AUTH_TOKEN>` |

Grok Bot stores the header on the server entry, and your LinkedIn client secret stays in your Vercel project.

## Check that it works

Ask your bot something read-only: "List my LinkedIn ad accounts" or "How did my LinkedIn account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and sets a campaign or an ad ACTIVE only when you explicitly ask.

## Connectors on grok.com

Custom connectors on grok.com sign in with OAuth, which the endpoint doesn't support yet. Use Grok Bot until it does.

## What runs in Grok

Every LinkedIn tool your endpoint serves: accounts, targeting and audience sizing, conversions, campaigns and ads, reporting and Ad Library search. CSV uploads, Salesforce and HubSpot audiences, the change journal and lift tools, and every Google Ads tool need your machine, so run those in [Claude Code](./clients-claude-code.md), [Codex](./clients-codex.md), [Cursor](./clients-cursor.md) or the [CLI](./clients-cli.md). See [Hosted limitations](./hosted.md#hosted-limitations).
