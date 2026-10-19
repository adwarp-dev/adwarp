---
title: Adwarp
description: "The open-source ad agent for LinkedIn Ads and Google Ads. Create campaigns by talking to your assistant over MCP, or from a CLI."
order: 1
---

Adwarp (formerly Liam) is the open-source ad agent for LinkedIn Ads and Google Ads. You describe the campaign in plain language and Adwarp drafts the audience, the ad groups, and the ads, from Claude Code, Claude Desktop, Cursor, Codex, or other MCP clients that can run a local server, or from a CLI. It covers creation, matched audiences (including building one straight from Salesforce or HubSpot), conversion selection, performance reporting, competitor ad intelligence, and a change journal with before and after lift.

Everything Adwarp creates starts switched off. LinkedIn entities are created as drafts and Google Ads entities as paused. A LinkedIn campaign goes live only when you explicitly ask Adwarp to turn it on or switch it on yourself in Campaign Manager, and Google campaigns can only be switched on in the Google Ads UI.

Adwarp is unofficial and not affiliated with or endorsed by LinkedIn or Google.

## What you can ask for

Once Adwarp is connected, you talk to your assistant in plain language. These are requests it handles today, roughly in the order a campaign comes together:

- "How many VPs of demand gen at US SaaS companies can we reach?" Adwarp resolves the targeting facets and estimates reach before any money is involved.
- "Upload this CSV as a matched audience." Adwarp cleans the columns, hashes emails, and converts company domains to URLs.
- "Build an audience from Salesforce: every contact on an account flagged as a target." A SOQL query goes straight to a matched audience.
- "Turn our HubSpot target accounts list into a LinkedIn audience." A HubSpot list or search becomes a matched audience of contacts or companies.
- "Launch a draft campaign for that audience, $100/day, tracking the demo-booked conversion." The campaign group, campaign, and draft ads are created in a single call.
- "What ads is our biggest competitor running right now, and what offers are they pushing?" Adwarp reads the public Ad Library: copy, formats, and EU targeting metadata for any company.
- "How did retargeting do last month compared to the month before?" You get a trend report with deltas.
- "Which ads should I pause this week?" You get an account rollup with top and bottom performers and flags. Name the ads to pause and Adwarp pauses each of them, leaving the rest of the ad group running.
- "Rewrite the copy on the losing ad." Adwarp deletes the ad and recreates it as a fresh draft, because LinkedIn ignores edits to a live ad's post.
- "Did the new headline actually help?" The change journal measures before and after lift.

Adwarp resolves the details and reports back the ids. Every capability is also an `adwarp` CLI command for scripted or batch use.

## Hierarchy mapping

LinkedIn names its levels differently from Google. Its names are shifted 1 level from everyone else's, which is the most common source of confusion when working across both platforms.

| Common term | LinkedIn entity | Google Ads entity | Holds |
| --- | --- | --- | --- |
| Campaign | Campaign Group | (none) | status, total or shared budget |
| Ad group | Campaign | Campaign | targeting, budget, bid, schedule, format |
| (none) | (none) | Ad group | keywords and the ads that answer them |
| Ad | Creative | Ad group ad | the rendered ad |
| Audience | DMP Segment | User list | attached to targeting |

So a LinkedIn campaign and a Google campaign are different things. Google's campaign holds the budget and targeting (LinkedIn's campaign group plus campaign), and its ad group holds keywords.

## Put it on a loop

Adwarp has no scheduler. Use the one in whatever client you drive it from. Some loops that work well:

- "Every Monday at 9am, pull last week's performance summary, compare it to the week before, and flag anything that moved more than 20%." This works as a Claude Code scheduled agent.
- "Every Friday, check what new ads our top 3 competitors shipped this week and summarize the angles."
- "Check the audience match status every few hours and tell me when it clears 300 members." That is the minimum for a matched audience to serve.
- Or skip the assistant entirely and put the CLI in cron: `0 9 * * 1 adwarp report summary -p last_7_days`.

## Get started

Start with [Create a LinkedIn app](./linkedin-app.md), then pick a path: [run the MCP server locally](./install.md), [connect to the hosted endpoint](./hosted.md), or [use the CLI](./cli.md).
