---
title: CLI
description: "Run Adwarp from your terminal with no AI client: install the adwarp command, check that it works, and put it on a schedule."
order: 18
---

Every capability of the MCP server is also an `adwarp` command, for your terminal, scripts and cron. It needs no AI client. [Create a LinkedIn app](./linkedin-app.md) first.

## Install

Requires Node.js 20 or newer. Run any command without installing, or install the command once:

```bash
npx -y adwarp --help
npm install -g adwarp
```

The package installs the `adwarp`, `adwarp-mcp` and `liam` commands. Save your app's Client ID and Secret as in [Authenticate](./install.md#authenticate), then sign in, which opens your browser and saves your tokens in `~/.adwarp`:

```bash
adwarp auth login
```

## Check that it works

```bash
adwarp accounts list
```

It lists the ad accounts your app can reach. Set `defaultAccountId` in `~/.adwarp/config.json` so you can leave `--account` off. For Google Ads, `adwarp google accounts list` proves the developer token and the OAuth client work.

## Change a single ad

`adwarp ad pause`, `adwarp ad resume` and `adwarp ad archive` change 1 ad without touching the rest of its ad group. Each previews the change until you add `--apply`, and `resume` sets the ad ACTIVE, which starts spend:

```bash
adwarp ad list <campaignId>
adwarp ad pause <creativeId>           # preview
adwarp ad pause <creativeId> --apply   # pause it
```

## Put it on a schedule

Adwarp has no scheduler of its own, so use cron. A Monday report at 9am:

```bash
0 9 * * 1 adwarp report summary -p last_7_days
```

See [CLI commands](./cli.md) for every command and option.
