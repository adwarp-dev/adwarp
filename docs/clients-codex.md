---
title: Codex
description: "Add Adwarp to the Codex CLI with 1 command, then check that it works."
order: 16
---

The Codex CLI runs Adwarp as a local MCP server with every tool, including the Google Ads tools. [Create a LinkedIn app](./linkedin-app.md) and [authenticate](./install.md#authenticate) first.

## Add the local server

```bash
codex mcp add adwarp -- npx -y adwarp mcp
```

The server reads the `~/.adwarp` credentials that `npx -y adwarp auth login` saved. The Google Ads `gads_*` tools need their own [Google Ads setup](./google-ads.md#setup).

## Check that it works

Start Codex and ask something read-only: "List my ad accounts" or "How did my account do in the last 30 days?"

Writes stay in your hands. Adwarp creates campaigns and ads as drafts, and pauses, resumes or archives a single ad when you name it. It sets a campaign or an ad ACTIVE only when you explicitly ask.

## Script it instead

Every tool is also an `adwarp` command with the same credentials and the same change journal, for scripts and cron. See [CLI](./clients-cli.md).
