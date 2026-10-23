---
title: Gemini
description: "Add Adwarp to Antigravity CLI, Google's Gemini agent for the terminal, or to Gemini CLI, then check that it works."
order: 19
---

Google's Gemini agent for the terminal is the Antigravity CLI, `agy`, which replaced Gemini CLI for individual accounts on June 18, 2026. It runs Adwarp as a local MCP server with every tool, including the Google Ads tools. [Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Add it to Antigravity CLI

1 command adds Adwarp for every project:

```bash
agy mcp add adwarp npx -y adwarp mcp
```

It writes the entry to `~/.gemini/config/mcp_config.json`. Run `agy mcp list`, or type `/mcp` inside a session, to check that `adwarp` is connected. The server reads the `~/.adwarp` credentials that `npx -y adwarp auth login` saved.

To add it to 1 project instead, put the same entry in `.agents/mcp_config.json` there. If the file already has an `mcpServers` object, add the `adwarp` entry to it.

```json
{
  "mcpServers": {
    "adwarp": { "command": "npx", "args": ["-y", "adwarp", "mcp"] }
  }
}
```

Antigravity IDE takes the same entry: open MCP Servers from the agent panel, then Manage MCP Servers, then View raw config.

## Or add it to Gemini CLI

Gemini CLI still runs for accounts that kept it. 1 command adds Adwarp for every project:

```bash
gemini mcp add -s user adwarp npx -y adwarp mcp
```

It writes the same entry to `~/.gemini/settings.json`. Run `gemini mcp list`, or `/mcp` inside a session, to check it.

## Check that it works

Ask Gemini something read-only: "List my ad accounts" or "How did my account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and pauses, resumes or archives a single ad when you name it. It sets a campaign or an ad ACTIVE only when you explicitly ask. Antigravity CLI and Gemini CLI also ask before they run a tool, unless you allow it.

In print mode (`agy -p`), Antigravity CLI can't ask, so it denies Adwarp's tools until you allow them in `~/.gemini/antigravity-cli/settings.json`, 1 tool at a time:

```json
{
  "permissions": {
    "allow": ["mcp(adwarp/list_ad_accounts)"]
  }
}
```

## The Gemini app

The Gemini app on the web adds remote MCP servers that sign in with OAuth, which the [hosted endpoint](./hosted.md) doesn't support yet. Use Antigravity CLI or Gemini CLI until it does.
