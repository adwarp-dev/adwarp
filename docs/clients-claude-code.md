---
title: Claude Code
description: "Add Adwarp to Claude Code as a local MCP server or through the hosted endpoint, then check that it works."
order: 13
---

Claude Code runs Adwarp as a local MCP server with every tool, or connects to the hosted endpoint for the LinkedIn tools. Either way, [create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Add the local server

```bash
claude mcp add adwarp -- npx -y adwarp mcp
```

The server reads the `~/.adwarp` credentials that `npx -y adwarp auth login` saved. It registers every tool, including the Google Ads `gads_*` tools, which need their own [Google Ads setup](./google-ads.md#setup).

## Or connect to the hosted endpoint

Print the connect command with your credentials as headers, then run the command it prints:

```bash
npx -y adwarp auth export --mcp
```

The hosted endpoint serves the LinkedIn tools only. See [Hosted endpoint](./hosted.md) for the headers and the trade-off of sending credentials with each request.

## Check that it works

Ask Claude something read-only: "List my ad accounts" or "How did my account do in the last 30 days?" Adwarp answers from your account, and nothing changes.

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and pauses, resumes or archives a single ad when you name it. It sets a campaign or an ad ACTIVE only when you explicitly ask.

## Add the skills

The skills turn the tools into playbooks for reporting, launches and audits. From a clone of the repo:

```bash
./skills/install.sh
```

It links each skill into `~/.claude/skills`. Restart your Claude Code session so it finds them. See [Skills](./skills.md).
