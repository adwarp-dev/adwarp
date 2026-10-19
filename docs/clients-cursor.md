---
title: Cursor
description: "Add Adwarp to Cursor with 1 click or 1 config entry, then check that it works."
order: 16
---

Cursor runs Adwarp as a local MCP server with every tool, including the Google Ads tools. [Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Add it with 1 click

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=adwarp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImFkd2FycCIsIm1jcCJdfQ==) opens Cursor and adds the local server.

## Or edit the config

Add this entry to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` inside a project. It's the same entry the button adds.

```json
{
  "mcpServers": {
    "adwarp": { "command": "npx", "args": ["-y", "adwarp", "mcp"] }
  }
}
```

The server reads the `~/.adwarp` credentials that `npx -y adwarp auth login` saved.

## Check that it works

Ask Cursor's agent something read-only: "List my ad accounts" or "How did my account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and pauses, resumes or archives a single ad when you name it. It sets a campaign or an ad ACTIVE only when you explicitly ask.
