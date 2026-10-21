---
title: Paid ads skills
description: "17 open-source skills for LinkedIn Ads and Google Ads that run in Claude Code, Codex or Cursor, from a CSV export or live through Adwarp."
order: 8
---

The skills live in their own repo, [adwarp-dev/paid-ads-skills](https://github.com/adwarp-dev/paid-ads-skills), under the MIT license. Each one is a playbook an agent follows: what to pull, how to judge it, the thresholds that matter, and a report that ends in ranked actions. They run in Claude Code, Codex, Cursor and any agent that reads `SKILL.md` files.

Every skill works 2 ways: from a CSV export of Campaign Manager or Google Ads with nothing connected, or live through Adwarp, where it pulls the data itself and drafts the changes it recommends once you confirm them.

## Install

```bash
npx skills add adwarp-dev/paid-ads-skills
```

In Claude Code you can add them as a plugin instead:

```text
/plugin marketplace add adwarp-dev/paid-ads-skills
/plugin install paid-ads-skills@adwarp
```

Or copy a folder from the repo's `skills/` directory into `~/.claude/skills/`. Each folder stands on its own.

## LinkedIn Ads

| Skill | Ask it | What you get |
| --- | --- | --- |
| `linkedin-ads-audit` | "Audit my LinkedIn ads account" | a scored check of tracking, structure, targeting, delivery settings, bidding, creative and UTMs, with fixes ranked by spend at risk |
| `linkedin-ads-performance-review` | "How are my LinkedIn ads doing?" | scale, pause and watch lists against like-for-like peers, week over week direction and creative fatigue |
| `linkedin-ads-spend-analysis` | "Where is my LinkedIn budget going?" | where the money goes, how concentrated it is, spend with nothing back, and the reallocation moves worth making |
| `linkedin-ads-lead-drivers` | "Which LinkedIn ads drive leads?" | a drivers list, a pause list with the money each ad burned, and the copy angles that convert |
| `linkedin-ads-pause-rules` | "Which LinkedIn ads should I pause?" | pause rules you approve up front and a dry-run table before anything is switched off |
| `linkedin-audience-sizing` | "How big should this audience be?" | a narrowing plan that lands the audience in range before you spend |
| `linkedin-audience-ops` | "Audit my matched audiences" | audience health, clean list uploads with a dry run, and CRM refreshes |
| `linkedin-abm-builder` | "Build 1:1 ads for these accounts" | an ad set plan per account: the audience, 3 ads and a fixed flight |
| `linkedin-campaign-launch` | "Launch a LinkedIn campaign for this" | a confirmed brief, sized before spend, built with safe defaults, created as drafts |
| `linkedin-ad-library-teardown` | "What LinkedIn ads is this company running?" | themes, offers, formats, run length and the gaps you can use |

## Google Ads

| Skill | Ask it | What you get |
| --- | --- | --- |
| `google-ads-account-audit` | "Audit my Google Ads account" | 50 checks with a GAQL query for each, and the fixes ranked |
| `google-ads-search-campaign-builder` | "Build a search campaign for this product" | keywords, structure and responsive search ads, ending in a paused launch brief |
| `google-ads-search-terms` | "Where is my search budget leaking?" | wasted spend and negative keyword candidates from the search terms report |

## Both platforms

| Skill | Ask it | What you get |
| --- | --- | --- |
| `paid-media-weekly-report` | "Write the weekly paid report" | the last 7 days against the 7 before, the movers, flags and 3 actions |
| `paid-media-health-check` | "Anything on fire in our ads?" | a daily check that stays silent unless something is wrong |
| `ad-experiment-lift` | "Did that change work?" | a hypothesis logged before the change, then before and after lift with the confounds stated |
| `ad-budget-pacing` | "Are we on pace this month?" | projected spend against your cap, quiet unless spend runs ahead |

## With Adwarp connected

With Adwarp installed as a local MCP server or the CLI (see [Install](./install.md)), each skill's Connected mode calls the tools in the [tool reference](./tools.md), such as `performance_summary` for reviews, `estimate_audience` for sizing and `gads_search` for the Google Ads audit. A skill that changes an account shows you the exact change and waits for you to confirm it, and Adwarp creates LinkedIn entities as drafts and Google campaigns paused. See [Safety](./safety.md).

Without Adwarp, every skill names the report to export and the columns it reads. Try them first on the made-up data in the repo's [examples folder](https://github.com/adwarp-dev/paid-ads-skills/tree/main/examples).

## Moving from the adwarp-* skills

The 11 skills that used to ship in this repo moved to paid-ads-skills under new names. Their old folders now hold a short pointer to the new skill, so an existing install keeps working until you switch.

| Old name | New name |
| --- | --- |
| adwarp-account-audit | `linkedin-ads-audit` |
| adwarp-performance | `linkedin-ads-performance-review` |
| adwarp-spend | `linkedin-ads-spend-analysis` |
| adwarp-leads | `linkedin-ads-lead-drivers` |
| adwarp-audiences | `linkedin-audience-ops` |
| adwarp-launch | `linkedin-campaign-launch` |
| adwarp-competitors | `linkedin-ad-library-teardown` |
| adwarp-gads-launch | `google-ads-search-campaign-builder` |
| adwarp-weekly | `paid-media-weekly-report` |
| adwarp-health | `paid-media-health-check` |
| adwarp-experiments | `ad-experiment-lift` |

To switch, install the new skills with the command above, then remove the old `adwarp-*`, `liam-*` and `gads-launch` links from `~/.claude/skills`.

## Your own playbook

For a team on the [hosted endpoint](./hosted.md#put-a-skill-on-top), a short skill of your own on top of these, holding your default ad account, naming and standing exclusions, keeps everyone on the same rules. Credentials never belong in a skill file.

## Contribute

New skills and fixes are welcome. The repo's [contributing guide](https://github.com/adwarp-dev/paid-ads-skills/blob/main/CONTRIBUTING.md) sets the format every skill follows and the quality bar: cited sources, honest caveats and a report that ends in ranked actions.
