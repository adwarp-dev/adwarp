---
title: Paid ads skills
description: "12 open-source skills for LinkedIn Ads and Google Ads that run from a CSV export or live through Adwarp: audits, reviews, pause rules, audience sizing, launch briefs, weekly reports, lift and pacing."
order: 20
---

The [paid ads skills](https://github.com/adwarp-dev/paid-ads-skills) are a separate, MIT-licensed set of agent skills for performance marketers. They run in Claude Code, Codex, Cursor and any agent that reads `SKILL.md` files, and each one works 2 ways: from a CSV export of Campaign Manager or Google Ads with nothing connected, or live through Adwarp, where they pull the data themselves and draft the changes they recommend.

The [Adwarp skills](./skills.md) in this repo assume Adwarp is installed. The paid ads skills don't, so anyone on your team can use them, and they get faster once Adwarp is connected.

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
| [`linkedin-ads-audit`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-ads-audit) | "Audit my LinkedIn ads account" | a scored check of tracking, structure, targeting, delivery settings, bidding, creative and UTMs, with fixes ranked by spend at risk |
| [`linkedin-ads-performance-review`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-ads-performance-review) | "How are my LinkedIn ads doing?" | scale, pause and watch lists, week over week direction and creative fatigue |
| [`linkedin-ads-pause-rules`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-ads-pause-rules) | "Which LinkedIn ads should I pause?" | pause rules you approve up front and a dry-run table before anything is switched off |
| [`linkedin-audience-sizing`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-audience-sizing) | "How big should this audience be?" | a narrowing plan that lands the audience in range before you spend |
| [`linkedin-abm-builder`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-abm-builder) | "Build 1:1 ads for these accounts" | an ad set plan per account: the audience, 3 ads and a fixed flight |
| [`linkedin-ad-library-teardown`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/linkedin-ad-library-teardown) | "What LinkedIn ads is this company running?" | themes, offers, formats, run length and the gaps you can use |

## Google Ads

| Skill | Ask it | What you get |
| --- | --- | --- |
| [`google-ads-account-audit`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/google-ads-account-audit) | "Audit my Google Ads account" | 40 to 50 checks with a GAQL query for each, and the fixes ranked |
| [`google-ads-search-campaign-builder`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/google-ads-search-campaign-builder) | "Build a search campaign for this product" | keywords, structure and responsive search ads, ending in a paused launch brief |
| [`google-ads-search-terms`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/google-ads-search-terms) | "Where is my search budget leaking?" | wasted spend and negative keyword candidates from the search terms report |

## Both platforms

| Skill | Ask it | What you get |
| --- | --- | --- |
| [`paid-media-weekly-report`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/paid-media-weekly-report) | "Write the weekly paid report" | the last 7 days against the 7 before, the movers, flags and 3 actions |
| [`ad-experiment-lift`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/ad-experiment-lift) | "Did that change work?" | a hypothesis logged before the change, then before and after lift with the confounds stated |
| [`ad-budget-pacing`](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/ad-budget-pacing) | "Are we on pace this month?" | projected spend against your cap, quiet unless spend runs ahead |

## With and without Adwarp

With Adwarp installed as a local MCP server or the CLI (see [Install](./install.md)), each skill's Connected mode calls the tools in the [tool reference](./tools.md), such as `performance_summary` for reviews, `estimate_audience` for sizing and `gads_search` for the Google Ads audit. A skill that changes an account shows you the exact change and waits for you to confirm it, and Adwarp creates LinkedIn entities as drafts and Google campaigns paused. See [Safety](./safety.md).

Without Adwarp, every skill names the report to export and the columns it reads. Try them first on the made-up data in the repo's [examples folder](https://github.com/adwarp-dev/paid-ads-skills/tree/main/examples).

## More on adwarp.dev

- [LinkedIn Ads from your terminal](https://adwarp.dev/linkedin-ads)
- [LinkedIn Ads optimization](https://adwarp.dev/linkedin-ads/optimization), where the pause rules and lift reads come from
- [LinkedIn audiences](https://adwarp.dev/linkedin-ads/audiences) and [account-based marketing](https://adwarp.dev/linkedin-ads/abm)
- [LinkedIn Ad Library](https://adwarp.dev/linkedin-ads/ad-library)
- [Google Ads from your terminal](https://adwarp.dev/google-ads)

## Contribute

New skills and fixes are welcome. The repo's [contributing guide](https://github.com/adwarp-dev/paid-ads-skills/blob/main/CONTRIBUTING.md) sets the format every skill follows and the quality bar: cited sources, honest caveats and a report that ends in ranked actions.
