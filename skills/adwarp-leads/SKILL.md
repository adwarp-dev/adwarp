---
name: adwarp-leads
description: Rank which LinkedIn ads actually drive leads and which burn budget without converting, using Adwarp creative-level reporting. Produces a drivers list, a pause list, and copy-angle patterns. Use for "which ads drive leads", "which ads don't convert", "cost per lead by ad", "what should I pause", "which creative is working".
---

# Adwarp: lead drivers and duds

Split every ad in scope into four buckets (drivers, promising, non-converters, too
early) and say what to do with each. The pause list with dollar amounts is usually the
most valuable output.

## How to reach Adwarp

Prefer the Adwarp MCP tools if they are loaded (`get_performance`, `list_ads`,
`list_campaigns`, `list_conversions`). Otherwise the CLI: `adwarp report perf creative`,
`adwarp ad list <campaignId>`, etc., or `npx -y adwarp`.
Read-only, except the explicitly-confirmed recreate flow at the end.

## What to pull

1. `get_performance` at `creative` level, default `last_30_days`. If total conversions
   across the account are under ~10, widen to `last_90_days` and say so.
2. `list_campaigns` and `list_ads` to join creative ids to ad names, statuses, and
   parent campaigns. Well-named ads (persona, competitor, offer in the name) let you
   analyze angle patterns; if names are opaque ids, say the analysis is per-ad only.
3. `list_conversions` to name which conversion is being counted. State it in the
   report; "leads" means nothing without the definition.

## How to bucket

Compute the account average cost per conversion first (total spend / total conversions
on converting entities).

- **Drivers:** 3+ conversions and cost per conversion at or below account average.
  Rank by conversions, then cost per conversion.
- **Promising:** 1-2 conversions at good efficiency, or strong CTR with spend still
  below the judgment floor. Watch, do not scale yet.
- **Non-converters:** zero conversions with spend at or above ~2x the account average
  cost per conversion. This is the pause list. Sum the wasted spend into one figure.
- **Too early:** under ~1,000 impressions or trivial spend. No verdict.

## Caveats to state

- Conversion counting lags clicks; treat the last 2-3 days as incomplete.
- LinkedIn mixes post-click and view-through conversions depending on setup; a
  retargeting ad can look like a driver while merely tailgating other touches. Flag
  suspiciously high conversion rates on tiny click counts.
- One conversion is an anecdote. Never crown a winner on fewer than 3.

## Angle patterns

When ad names or copy encode the angle (persona, competitor, pain, offer), aggregate
buckets by angle and report which angles convert and which never do. This is often more
actionable than the per-ad list, because it tells the user what to make next, not just
what to kill.

## Report format

- **Headline:** conversion total, account average cost per conversion, and the wasted
  spend figure from the pause list.
- **Drivers table:** name, campaign, conversions, cost per conversion, CTR.
- **Pause list:** name, campaign, spend burned, impressions. One line each on why.
- **Angle read:** converting angles vs dead angles, if names permit.
- **Actions:** scale/shift suggestions plus refresh candidates. On LinkedIn, changing
  copy means recreate, not edit (`delete_ad` + `create_image_ad`, drafts only). Only
  run deletes if the user explicitly confirms the exact ads; pausing and activating
  happen only on the user's explicit request, through Adwarp or in Campaign Manager.
- Afterwards, suggest journaling any change made (`log_ad_change`) so `compute_lift`
  can measure it later.
