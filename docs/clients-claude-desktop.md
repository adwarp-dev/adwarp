---
title: Claude Desktop
description: "Add Adwarp to Claude Desktop's MCP config, restart the app, and check that it works."
order: 15
---

Claude Desktop runs Adwarp as a local MCP server with every tool, including the Google Ads tools. [Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Add it to the config

Add this entry to Claude Desktop's MCP config, `claude_desktop_config.json`. On macOS it's in `~/Library/Application Support/Claude/`, and on Windows in `%APPDATA%\Claude\`. Settings, then Developer, then Edit Config opens it.

```json
{
  "mcpServers": {
    "adwarp": { "command": "npx", "args": ["-y", "adwarp", "mcp"] }
  }
}
```

Then restart Claude Desktop. The server reads the `~/.adwarp` credentials that `npx -y adwarp auth login` saved.

After `npm install -g adwarp` you can use `adwarp-mcp` as the command instead of going through npx.

## Check that it works

Ask Claude something read-only: "List my ad accounts" or "How did my account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and pauses, resumes or archives a single ad when you name it. It sets a campaign or an ad ACTIVE only when you explicitly ask.

## The hosted endpoint

Clients without native HTTP transport reach the hosted endpoint through `npx mcp-remote <url>` with your headers. See [Hosted endpoint](./hosted.md#connect). The hosted endpoint serves the LinkedIn tools only, so the local server is the way to run Google Ads.
