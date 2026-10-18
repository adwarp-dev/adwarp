---
title: Install
description: "Build Adwarp, authenticate with LinkedIn, and register the local MCP server with Claude Code, Claude Desktop, Cursor, or any MCP client."
order: 3
---

There are 2 ways to run Adwarp:

1. As an MCP server, registered with Claude Code, Claude Desktop, Cursor, or any MCP client, so you create campaigns by talking to your assistant. Run it locally (this page), or skip the always-on install and [connect to the hosted endpoint](./hosted.md) with your own credentials.
2. As a terminal CLI, a global `adwarp` command for your terminal, scripts, or cron. See [CLI](./cli.md).

Both paths start the same way: [create a LinkedIn app](./linkedin-app.md), then build and authenticate as below. They read the same `~/.liads` credentials, so you can do both.

## Build and authenticate

Requires git, Node.js 20 or newer, and pnpm.

```bash
git clone https://github.com/adwarp-dev/adwarp.git
cd adwarp
pnpm install && pnpm -r build

# App credentials (alternatively set LIADS_CLIENT_ID / LIADS_CLIENT_SECRET env vars)
mkdir -p ~/.liads
echo '{ "clientId": "...", "clientSecret": "...", "linkedinVersion": "202605" }' > ~/.liads/config.json

node packages/cli/dist/index.js auth login      # opens the browser; tokens land in ~/.liads
node packages/cli/dist/index.js accounts list   # verify, then set defaultAccountId in config.json
```

See [Configuration](./config.md) for every field in `config.json`.

## Register the local MCP server

Register the server with your MCP client. It reads the `~/.liads` credentials from the previous step.

Claude Code:

```bash
claude mcp add adwarp -- node /absolute/path/to/adwarp/packages/mcp/dist/index.js
```

Claude Desktop, Cursor, or any other MCP client, in its MCP config JSON:

```json
{
  "mcpServers": {
    "adwarp": { "command": "node", "args": ["/absolute/path/to/adwarp/packages/mcp/dist/index.js"] }
  }
}
```

Ask for something read-only to confirm it works: "List my ad accounts" or "How did my account do in the last 30 days?"

The local server registers every tool, including the Google Ads `gads_*` tools. Those need their own credentials, covered in [Google Ads](./google-ads.md).
