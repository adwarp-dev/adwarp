---
name: adwarp-weekly
description: A compact weekly LinkedIn ads snapshot from Adwarp. Last 7 days vs the 7 before, biggest movers, new ads shipped, health flags, and up to 3 actions, in the same format every week. Use for "weekly snapshot", "how did ads do this week", "Monday ads report", or on a schedule (scheduled agents, /loop, cron).
---

# Adwarp: weekly snapshot

A snapshot, not a report. The same shape every week so weeks are comparable at a
glance, short enough to read in a Slack message. Target under 40 lines of output.

## How to reach Adwarp

Prefer the Adwarp MCP tools if they are loaded. This skill wants 2 exact 7-day
windows, so use `get_performance` with explicit `startDate`/`endDate` (YYYY-MM-DD):
the last 7 full days, and the 7 before those. On the CLI, `adwarp report summary -p
last_7_days` plus `adwarp report trend <level> <id> -b weekly` approximates it. Also pull
`list_campaigns` (structure and statuses), `list_ads` on active campaigns if ad-level
movers are wanted, and `list_ad_changes` for what was changed this week. Read-only.

## What goes in

1. **Scoreboard:** spend, impressions, CTR, conversions, cost per conversion for this
   week, each with the week-over-week delta.
2. **Movers:** entities whose CTR, spend, or cost per conversion moved more than ~20%
   week over week, on at least ~1,000 impressions in both weeks. Cap at 3 up, 3 down.
3. **New this week:** ads or campaigns that appeared (from `list_campaigns` /
   `list_ads`), and journaled changes (`list_ad_changes`) so the reader connects moves
   to outcomes.
4. **Flags:** ACTIVE campaigns with zero delivery, audiences still matching or under
   300 members, creatives with CTR down 2-plus weeks running, conversion counts
   likely still lagging for the last 2 days.
5. **Do this week:** at most 3 actions, imperative, each tied to a number above.

## Rules

- Same section order every week; never add sections ad hoc.
- Deltas as signed percentages; money in account currency.
- No verdicts on entities below the volume floor; skip them silently here (the deep
  dives are adwarp-performance and adwarp-leads, and the snapshot should say so only when
  something big warrants it).
- If the week was quiet, say it in 1 line and keep the snapshot short rather than
  inflating noise into findings.

## Report format

```
LinkedIn ads, <start> to <end>
Spend $X (+Y%) | Leads N (+Y%) | CPL $X (+Y%) | CTR X% (+Y%)

Up: ...
Down: ...
New: ...
Flags: ...

Do this week:
1. ...
```

## Running it on a schedule

- Claude Code scheduled agent: "Every Monday at 9am, run the adwarp-weekly skill and
  send me the snapshot."
- Or /loop with a weekly interval in a long-lived session.
- Or cron the raw feed and let a session synthesize:
  `0 9 * * 1 adwarp report summary -p last_7_days`.
