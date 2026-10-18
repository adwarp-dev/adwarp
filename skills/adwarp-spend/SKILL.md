---
name: adwarp-spend
description: Analyze LinkedIn ad spend with Adwarp. Where the budget actually goes, spend concentration, wasted spend with zero results, pacing, and concrete reallocation moves. Use for "analyze my spend", "where is my budget going", "what are we wasting money on", "spend breakdown", "am I overspending".
---

# Adwarp: spend analysis

Answer one question: is the money going where the results are? Produce a verdict and
moves, never a raw table dump.

## How to reach Adwarp

Prefer the Adwarp MCP tools if they are loaded (`list_campaigns`, `get_performance`,
`performance_summary`, `performance_trend`). Otherwise use the CLI: `adwarp <command>`,
or `npx -y adwarp <command>` if it isn't installed globally.
CLI report presets: `last_7_days`, `last_30_days`, `last_90_days`, `month_to_date`,
`last_month`. For custom windows use the MCP tools with explicit `startDate`/`endDate`
(YYYY-MM-DD). Everything here is read-only.

## What to pull

Default period is `last_30_days` unless the user names one.

1. `performance_summary` for the account rollup: total spend, conversions, flags.
2. `get_performance` at `campaign_group` level, then `campaign` level, then `creative`
   level. Spend, impressions, clicks, conversions per row.
3. `performance_trend` (weekly) at account or top-group level for pacing.
4. `list_campaigns` for the structure: names, statuses, and which entities are ACTIVE
   but absent from reporting (active with zero delivery is itself a finding).

## How to analyze

Compute the account average cost per conversion first; it is the yardstick for waste.

1. **Total and direction.** Total spend for the period and the delta vs the prior
   equivalent period (from the trend, or a second `get_performance` window).
2. **Concentration.** Share of spend per campaign group. Flag when one group takes
   more than ~60% of spend; say whether its share of conversions justifies it.
3. **Efficiency map.** For each group and campaign: spend, conversions, cost per
   conversion, and share-of-spend vs share-of-conversions. The interesting rows are
   the ones where those two shares diverge.
4. **Wasted spend.** Entities with zero conversions whose spend exceeds ~2x the
   account average cost per conversion. Sum this into one "wasted this period" dollar
   figure; it is usually the headline. Also flag CPC outliers above ~1.5x the account
   average and CTR below ~0.3% on meaningful volume.
5. **Pacing.** From the weekly trend: is daily spend accelerating or decaying? Note
   anything that looks like a campaign silently dying (delivery falling week over week
   with unchanged status).

## Judgment rules

- Never judge an entity with under ~1,000 impressions or trivial spend; label it
  "too early" instead.
- Conversions lag clicks. Treat the last 2-3 days as incomplete and say so.
- Compare within the account first; industry benchmarks are context, not verdicts.
- Money figures in the account currency, rounded sensibly.

## Report format

- **Headline:** total spend, period delta, and a one-line verdict.
- **Where it goes:** top spend lines with cost per conversion, worst divergences called out.
- **What is wasted:** ranked list with dollar amounts, and the summed waste figure.
- **Moves:** 2-4 reallocations, each "shift $X/day from A to B because...". If the user
  wants to act on them, make each change only on their explicit request, through Adwarp
  or in Campaign Manager. This skill never activates or pauses anything on its own.
