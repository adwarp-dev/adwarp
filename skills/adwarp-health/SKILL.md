---
name: adwarp-health
description: Daily LinkedIn ads guardrail check via Adwarp that stays silent unless something is wrong. Catches active campaigns with zero delivery, daily spend spikes, cost-per-lead blowouts, spend with nothing back, stuck audiences, and CTR collapses. 1 line when all clear. Use for "health check", "anything on fire", "daily ads check", or on a morning schedule.
---

# Adwarp: daily health check

An alarm, not a report. If nothing trips, the entire output is 1 line. The weekly
digest is adwarp-weekly; deep dives are adwarp-performance and adwarp-spend. Never pad an
all-clear into a report.

## How to reach Adwarp

Prefer the Adwarp MCP tools: `get_performance` with explicit `startDate`/`endDate`
(yesterday, plus trailing 7-day and 30-day windows for baselines), `list_campaigns`
for statuses, `get_audience_status` for any segment ids known from the change
journal. CLI presets approximate the windows if MCP is unavailable.

## Checks

Defaults below; honor user-set thresholds if given.

1. **Zero delivery.** An ACTIVE campaign served zero impressions yesterday after
   delivering during the trailing week.
2. **Spend spike.** Yesterday's spend above ~1.5x the trailing 7-day daily average,
   checked at account level and per campaign.
3. **Cost-per-lead blowout.** Trailing 7-day cost per conversion above ~2x the
   trailing 30-day average, on at least 3 conversions of volume.
4. **Burn with nothing back.** Any entity that spent more than ~2x the account
   average cost per conversion over the trailing 7 days with zero conversions.
5. **Audience stuck.** A segment matching for over 48h, or an attached audience
   under 300 members (it is silently not serving).
6. **CTR collapse.** Yesterday's CTR below half the trailing 7-day average on 1,000+
   impressions; usually a creative rejection, serving change, or tracking break.

## Output

All clear, exactly:

```
LinkedIn ads: all clear (spend $X yesterday, N leads).
```

Fires: a numbered list, 1 line each: what tripped, the entity, the number vs its
baseline, and the suggested action. Order by dollars at stake. No sections, no
narrative. If conversions for yesterday may still settle (they lag 2-3 days), append
that caveat once at the bottom.

## Scheduling

Built to run unattended every morning: a Claude Code scheduled agent ("run the
adwarp-health skill and send only its output"), a /loop in a long-lived session, or
cron feeding the CLI. Pair with adwarp-weekly on Mondays; the 2 do not overlap.
