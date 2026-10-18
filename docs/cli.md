---
title: CLI
description: "Install the global adwarp command and look up every CLI command for LinkedIn Ads and Google Ads."
order: 6
---

Every capability of the MCP server is also an `adwarp` CLI command, for your terminal, scripts, batch runs, and cron.

## Install the global command

The [build step](./install.md#build-and-authenticate) already left a working CLI at `node packages/cli/dist/index.js`. To get a global `adwarp` command instead of the long `node` path:

```bash
cd packages/cli && pnpm link --global
adwarp accounts list
```

No pnpm link? A shell alias works too: `alias adwarp="node /absolute/path/to/adwarp/packages/cli/dist/index.js"`.

Coming from Liam? `liam` still works as an alias for `adwarp`. The link installs both names, so existing scripts and cron jobs keep running.

A sensible first session:

```bash
adwarp targeting search titles "demand generation"   # resolve targeting URNs
adwarp report summary -p last_30_days                # account rollup and flags
adwarp launch --brief examples/brief.json            # creates DRAFTS only
```

## LinkedIn commands

All commands also work as `node packages/cli/dist/index.js <command>`.

```
adwarp auth login                         # OAuth, stores tokens in ~/.liads
adwarp auth export                        # print env vars for a self-hosted (Vercel) server
adwarp auth export --mcp [url]            # print the hosted MCP connect command with your headers
adwarp accounts list                      # list accessible ad accounts
adwarp targeting search <facet> <query>   # typeahead a facet for entity URNs
adwarp targeting estimate <facet> <urns...>   # audience size for 1 facet's URNs
adwarp audience upload -n <name> -f <csv> [-t contact|company]   # clean and upload a CSV as a matched audience
adwarp audience upload -n <name> -f <csv> --dry-run   # preview the cleaned CSV, no upload
adwarp audience from-salesforce -n <name> -q "<SOQL>" [--email-field <column>]   # Salesforce query to matched audience
adwarp audience status <segmentId>        # matching status and resolved size
adwarp conversions list                   # account conversions (pick 1 to track)
adwarp campaigns list [--group <id>] [--all]   # campaign groups and ad groups, drafts included
adwarp campaigns get <campaignId>         # an ad group's status, name, and current targeting
adwarp campaigns update <campaignId> ... [--apply]   # change an ad group in place, previews unless --apply
adwarp ad list <campaignId>               # ads in an ad group (id, status, name), drafts included
adwarp ad delete <creativeId>             # delete an ad (creative and its Direct Sponsored Content post)
adwarp report summary [-p <period>]       # account rollup: totals, top performers, flags
adwarp report perf <level> [--parent <id>] [-p <period>]   # per-entity metric rows
adwarp report trend <level> <id> [-b weekly|monthly] [-p <period>]   # trend with deltas
adwarp launch --brief <brief.json>        # audience, campaign group, campaign, and draft ads
adwarp competitor ads <advertiser>        # any company's ads from the public Ad Library
adwarp creative-status <ids>              # read remote creative jobs by comma-separated ad id
adwarp changelog list [-t <type>] [-i <id>] [--tag <tag>]   # recorded ad changes, newest first
adwarp changelog add -t <type> -i <id> -f <field> --after <value> [-l <label>]   # log a change made elsewhere
adwarp lift <level> <id> [-w <days>]      # before and after performance for each recorded change
```

Periods: `last_7_days`, `last_30_days`, `last_90_days`, `month_to_date`, `last_month`.

`--account` defaults to `defaultAccountId` from [config](./config.md) where it applies.

Run `adwarp <command> --help` for every option of a command, for example the budget, bid, targeting, and rotation flags of `campaigns update`.

### Competitor ads options

`<advertiser>` is a company name, a numeric company id, or a company URL.

| Option | Meaning |
| --- | --- |
| `--company-id <id>` | force a numeric LinkedIn company id, the most precise match |
| `-k, --keyword <text>` | keyword search across ad copy instead of an advertiser |
| `-c, --country <codes>` | comma-separated ISO country codes, for example `US,GB` |
| `-e, --engine auto\|api` | `auto` (default) adds the remote creative worker, `api` is metadata only |
| `-m, --max <n>` | maximum ads to collect (default 50) |
| `--no-deep` | skip remote creative collection |
| `--copy-max <n>` | remote creative sample size (default and maximum 10) |
| `--json` | print raw JSON instead of a summary |

### Change journal options

`changelog add` also takes `--before <value>`, `-n, --note <text>` for a freeform note instead of a field change, `--name <name>`, `--tags <list>`, and `--at <iso>` for when the change took effect. Both `changelog list` and `lift` take `--json`. See [Change journal and lift](./journal.md).

## Google Ads commands

Google Ads lives under `adwarp google`. See [Google Ads](./google-ads.md) for setup.

```
adwarp google auth login                  # OAuth, stores tokens in ~/.liads/google-credentials.json
adwarp google accounts list               # every customer this login can reach
adwarp google accounts clients <managerId>   # client accounts under a manager account
adwarp google keywords <seeds...> [-u <url>] [-l <codes>] [--language <code>] [-n <limit>]   # keyword ideas
adwarp google campaigns list [--all]      # campaigns with their ad groups, paused included
adwarp google ads <adGroupId>             # ads in an ad group, with their responsive search copy
adwarp google conversions list            # conversion actions, to name 1 in a brief
adwarp google launch --brief <brief.json> [--apply]   # paused Search campaign, dry run unless --apply
adwarp google report perf <level> [-p <period>] [--campaign <id>]   # campaign|ad_group|ad|keyword|search_term
adwarp google query "<GAQL>"              # raw read-only GAQL query
```

Commands that read an account take `-c, --customer <id>`, which defaults to `defaultCustomerId` in `~/.liads/google.json`.
