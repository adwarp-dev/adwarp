---
title: LinkedIn Ads
description: "What Adwarp does on LinkedIn Ads, area by area, with the tools behind each one."
order: 18
---

Adwarp runs LinkedIn Ads through your own developer app, with tools for targeting, audiences, campaigns, reporting, competitor ads and the change journal. Everything it creates starts as a draft. A campaign or a single ad goes live only when you explicitly ask Adwarp to set it ACTIVE, or when you switch it on in Campaign Manager.

Before you start, [create a LinkedIn app](./linkedin-app.md) with the Advertising API, then [install](./install.md) Adwarp. Uploading lists needs the Audiences product, and competitor ads need the LinkedIn Ad Library product.

## Naming

LinkedIn's names sit 1 level off from other ad platforms, which trips up everyone the first time.

| You might say | LinkedIn calls it | Holds |
| --- | --- | --- |
| Campaign | Campaign group | status, total or shared budget |
| Ad group | Campaign | targeting, budget, bid, schedule, format |
| Ad | Creative | the rendered ad |
| Audience | Matched audience | attached to targeting |

## What it covers

- [Accounts](./tools.md#accounts): the ad accounts your app can reach.
- [Targeting](./tools.md#targeting): resolve plain-language targeting to facets and entity URNs, and estimate reach before anything is built.
- [Audiences](./tools.md#audiences): upload a CSV or a Salesforce query as a matched audience, then check its match status.
- [Conversions](./tools.md#conversions): pick the insight-tag conversion a campaign tracks.
- [Campaigns](./tools.md#campaigns): create campaign groups, campaigns and ads as drafts, change an ad group in place with `update_campaign`, and pause, resume or archive a single ad with `update_ad`.
- [Orchestrator](./tools.md#orchestrator): `launch_from_brief` creates the audience, campaign group, campaign and draft ads in 1 call.
- [Reporting](./tools.md#reporting): account rollups, per-entity metrics and trends with deltas.
- [Competitor intel](./tools.md#competitor-intel): any company's ads from the official LinkedIn Ad Library.
- [Change journal](./tools.md#change-journal): every change Adwarp makes, changes you log yourself, and before and after lift.

## Where it runs

The local MCP server and the CLI run every LinkedIn tool. The [hosted endpoint](./hosted.md) registers them too, but CSV uploads, Salesforce audiences and the change journal need your machine, so run those locally. See [Hosted limitations](./hosted.md#hosted-limitations).
