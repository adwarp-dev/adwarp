---
title: Install
description: "Install Adwarp from npm, authenticate with LinkedIn, and register the local MCP server with Claude Code, Claude Desktop, Cursor, Codex, or other MCP clients that can run a local server."
order: 3
---

There are 2 ways to run Adwarp:

1. As an MCP server, registered with Claude Code, Claude Desktop, Cursor, Codex, or other MCP clients that can run a local server, so you create campaigns by talking to your assistant. Run it locally (this page), or skip the always-on install and [connect to the hosted endpoint](./hosted.md) with your own credentials.
2. As a terminal CLI, a global `adwarp` command for your terminal, scripts, or cron. See [CLI](./cli.md).

Both come from the same npm package, `adwarp`, and both start the same way: [create a LinkedIn app](./linkedin-app.md), then authenticate as below. They read the same `~/.adwarp` credentials, so you can do both.

## Authenticate

Requires Node.js 20 or newer.

```bash
# App credentials (alternatively set ADWARP_LINKEDIN_CLIENT_ID / ADWARP_LINKEDIN_CLIENT_SECRET env vars)
mkdir -p ~/.adwarp
echo '{ "clientId": "...", "clientSecret": "...", "linkedinVersion": "202605" }' > ~/.adwarp/config.json

npx -y adwarp auth login      # opens the browser; tokens land in ~/.adwarp
npx -y adwarp accounts list   # verify, then set defaultAccountId in config.json
```

See [Configuration](./config.md) for every field in `config.json`.

## Register the local MCP server

Register the server with your MCP client. It reads the `~/.adwarp` credentials from the previous step. Each client also has its own page: [Claude Code](./clients-claude-code.md), [Claude Desktop](./clients-claude-desktop.md), [Codex](./clients-codex.md), [Cursor](./clients-cursor.md) and [Gemini](./clients-gemini.md).

Claude Code:

```bash
claude mcp add adwarp -- npx -y adwarp mcp
```

Claude Desktop, Cursor, or other MCP clients that can run a local server, in the client's MCP config JSON:

```json
{
  "mcpServers": {
    "adwarp": { "command": "npx", "args": ["-y", "adwarp", "mcp"] }
  }
}
```

`adwarp mcp` and the `adwarp-mcp` command start the same server. After `npm install -g adwarp` you can register `adwarp-mcp` directly instead of going through npx.

Ask for something read-only to confirm it works: "List my ad accounts" or "How did my account do in the last 30 days?"

The local server registers every tool, including the Google Ads `gads_*` tools. Those need their own credentials, covered in [Google Ads setup](./google-ads.md#setup).

## Run it in Docker

The Dockerfile at the root of the repo builds an image that runs the same MCP server on stdio. Authenticate on your machine first, then pass the credentials in as environment variables:

```bash
docker build -t adwarp https://github.com/adwarp-dev/adwarp.git
mkdir -p ~/.adwarp && npx -y adwarp auth export > ~/.adwarp/docker.env   # your login as ADWARP_LINKEDIN_* values; treat as a secret
docker run -i --rm --env-file ~/.adwarp/docker.env -e ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID=<id> adwarp
```

To register it with an MCP client, use `docker` as the command and the `run` arguments above as its args. On macOS you can mount `-v ~/.adwarp:/home/node/.adwarp` (or `-v ~/.liads:/home/node/.liads` on an install from before the rename) instead of the env file, which also keeps the change journal on your machine.

## From source

For contributors, or to run changes that are not released yet. Requires git and pnpm as well.

```bash
git clone https://github.com/adwarp-dev/adwarp.git
cd adwarp
pnpm install && pnpm -r build

node packages/cli/dist/index.js accounts list
claude mcp add adwarp -- node /absolute/path/to/adwarp/packages/mcp/dist/index.js
```
