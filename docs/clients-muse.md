---
title: Meta Muse
description: "Connect Meta Muse to your own Adwarp endpoint with 1 bearer token, then check that it works."
order: 19
---

Meta Muse runs on a computer in Meta's cloud, so it can't start Adwarp on your machine or reach a server there. It connects over the internet to your own copy of the [hosted endpoint](./hosted.md) instead, and gets the LinkedIn tools that endpoint serves. The Google Ads tools need the local server, so they don't run in Muse yet.

[Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Deploy your endpoint

Muse adds a custom MCP server with 1 secret, a bearer token. The shared endpoint at `mcp.adwarp.dev` takes 3 credential headers, so deploy your own, which takes 1 `MCP_AUTH_TOKEN`.

1. Print your LinkedIn values: `npx -y adwarp auth export`.
2. Make a token: `openssl rand -hex 32`.
3. Click [Deploy to Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fadwarp-dev%2Fadwarp&root-directory=apps%2Fweb&project-name=adwarp-mcp&repository-name=adwarp-mcp&env=ADWARP_LINKEDIN_CLIENT_ID,ADWARP_LINKEDIN_CLIENT_SECRET,ADWARP_LINKEDIN_REFRESH_TOKEN,MCP_AUTH_TOKEN&envDescription=LinkedIn%20app%20values%20from%20npx%20-y%20adwarp%20auth%20export%20and%20a%20long%20random%20MCP_AUTH_TOKEN%20that%20your%20AI%20app%20sends%20as%20a%20bearer%20token.&envLink=https%3A%2F%2Fadwarp.dev%2Fdocs%2Fhosted%23self-host-on-vercel). It copies this repo into your GitHub account, sets the Root Directory to `apps/web` and asks for these 4 values:

| Variable | Value |
| --- | --- |
| `ADWARP_LINKEDIN_CLIENT_ID` | from `auth export` |
| `ADWARP_LINKEDIN_CLIENT_SECRET` | from `auth export` |
| `ADWARP_LINKEDIN_REFRESH_TOKEN` | from `auth export` |
| `MCP_AUTH_TOKEN` | the token you made |

Your endpoint is `https://<your-app>.vercel.app/api/mcp`. If Vercel Authentication covers production in your team's Deployment Protection settings, turn it off for production, or Muse can't reach the endpoint. To set the project up by hand instead, follow [Self-host on Vercel](./hosted.md#self-host-on-vercel).

## Add it in Muse

Send Muse this message with your endpoint's URL:

```
Add a custom MCP server called adwarp at https://<your-app>.vercel.app/api/mcp
```

Then answer its questions:

| Muse asks | Answer |
| --- | --- |
| Transport | HTTP |
| Auth | Bearer token |
| Key | your `MCP_AUTH_TOKEN` |

Type the token into Muse's secure prompt, never into the chat, where it would stay in your history. Muse keeps it in its credential store, and your LinkedIn client secret stays in your Vercel project.

## Check that it works

Ask Muse something read-only: "List my LinkedIn ad accounts" or "How did my LinkedIn account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and sets a campaign or an ad ACTIVE only when you explicitly ask. Muse's own settings can also make it ask before every action.

## What runs in Muse

Every LinkedIn tool your endpoint serves: accounts, targeting and audience sizing, conversions, campaigns and ads, reporting and Ad Library search. CSV uploads, Salesforce and HubSpot audiences, the change journal and lift tools, and every Google Ads tool need your machine, so run those in [Claude Code](./clients-claude-code.md), [Codex](./clients-codex.md), [Cursor](./clients-cursor.md) or the [CLI](./clients-cli.md). See [Hosted limitations](./hosted.md#hosted-limitations).
