---
name: adwarp-performance
description: Full performance review of a LinkedIn ads account via Adwarp. KPIs by campaign group, campaign, and ad, top and bottom performers, week-over-week direction, creative fatigue, and a scale/pause/watch action list. Use for "how are my ads doing", "analyze my performance", "performance review", "what should I scale or pause".
---

# Adwarp: performance review

Produce a review a growth lead could act on in ten minutes: verdict, winners, losers,
watchlist, actions. Every claim grounded in a number.

## How to reach Adwarp

Prefer the Adwarp MCP tools if they are loaded (`performance_summary`, `get_performance`,
`performance_trend`, `list_campaigns`, `list_ads`). Otherwise the CLI: `adwarp report ...`,
or `npx -y adwarp` if it isn't installed globally. CLI presets cap
at 90 days; for custom windows use the MCP tools with `startDate`/`endDate`. Read-only.

## Scope

Default to the whole account over `last_30_days`. If the user names a campaign group,
campaign, or period, scope to it. If total conversions in the window are under ~10,
widen to `last_90_days` and say you did.

## What to pull

1. `performance_summary` for the rollup, top/bottom performers, and flags.
2. `get_performance` at `campaign_group`, `campaign`, and `creative` levels.
3. `performance_trend` (weekly) on the account and on the top 2-3 spend campaigns.
4. `list_campaigns` to map ids to names/statuses and to catch ACTIVE entities with no
   delivery (drafts are expected to be absent; actives are not).

## KPI framework

Judge in this order, and never let an upstream metric excuse a downstream one:

1. **Delivery:** impressions, spend. Nothing else matters if it is not serving.
2. **Engagement:** CTR, CPC. Is the creative earning the click?
3. **Outcome:** conversions, conversion rate, cost per conversion. The only layer that
   pays rent. An ad with a great CTR and no conversions is a pause candidate, not a
   winner.

Compare within the account first: compute account averages for CTR, CPC, and cost per
conversion and measure each entity against them. Industry context only as rough guide
rails (LinkedIn B2B single-image ads: CTR ~0.4-0.6%, CPC ~$8-16, CPM ~$30-60; lead-gen
cost per conversion varies too much to benchmark honestly).

## Judgment rules

- **Significance floor:** no winner/loser verdicts on creatives under ~1,000 impressions
  or ~3 conversions. Bucket them as "too early".
- **Fatigue:** CTR falling two or more consecutive weeks on unchanged creative and
  targeting means the creative is wearing out. The fix on LinkedIn is recreate, not
  edit: Campaign Manager ignores post edits, so copy changes are `delete_ad` +
  `create_image_ad` (as new drafts).
- **Recency:** conversions lag; exclude or caveat the last 2-3 days.
- If the account journal has entries (`list_ad_changes`), check whether recent moves
  line up with metric shifts, and mention `compute_lift` for a before/after read.

## Report format

- **Verdict:** one paragraph. Direction, the single biggest problem, the single
  biggest win.
- **Scoreboard:** spend, impressions, CTR, CPC, conversions, cost per conversion, each
  with the week-over-week or period-over-period delta.
- **Winners:** entities beating account average cost per conversion on real volume, and
  what scaling them would mean.
- **Losers:** entities to pause or refresh, with the number that convicts each one.
- **Watchlist:** too-early entities worth rechecking next week.
- **Actions:** 3-5 items max, ordered by expected impact. This skill never activates
  or pauses anything itself; a change happens only when the user explicitly asks for it.
