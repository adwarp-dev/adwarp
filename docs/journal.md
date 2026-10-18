---
title: Change journal and lift
description: "Adwarp journals every change to an ad entity, so you can compare performance in the window before a change against the window after it."
order: 9
---

Adwarp keeps an append-only journal of every change made to an ad entity, so you can measure the lift of a change: how performance differed in the window before it versus the window after.

- Where it lives: `~/.adwarp/changelog.jsonl`, a plain local file with a JSON object per line. There is no database, no account, and nothing to set up. Override the path with `ADWARP_CHANGELOG_PATH`.
- Auto-capture: every create or update Adwarp makes to a campaign group, campaign, or creative is journaled automatically. Capture happens at the single HTTP chokepoint every write passes through, so it cannot be forgotten. Ad status changes (`adwarp ad pause`, `update_ad`) are recorded under the numeric creative id, the same id `adwarp lift creative <id>` takes.
- Manual entries: log changes made outside Adwarp (for example in Campaign Manager), or attach a hypothesis, with `adwarp changelog add` or the `log_ad_change` tool. Use `-l, --label` to name the test (for example `"outcome-led headline test"`) and `--tags` to group related changes.
- Lift: `adwarp lift <level> <entityId>` (or the `compute_lift` tool) reads the journal for that entity. For each change, it compares the `--window` days before (default 14) against the same window after, and reports before and after metrics with per-metric deltas: click-through rate, cost per click, conversion rate, cost per conversion, and more. Recent changes get a clamped, `partial` after-window.

```bash
adwarp changelog add -t creative -i 123456789 -f headline --after "Book a demo in 2 minutes" -l "outcome-led headline test"
adwarp changelog list -i 123456789
adwarp lift creative 123456789 -w 14
```

This is a directional before and after comparison, not a controlled experiment. It is confounded by seasonality, the LinkedIn learning phase after an edit, and any concurrent budget change, so treat the deltas as a signal.

Set `ADWARP_NO_CHANGELOG=1` to turn off auto-capture. Journaling is also off on hosted deploys, which have a read-only filesystem.
