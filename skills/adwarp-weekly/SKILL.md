---
name: adwarp-weekly
description: Moved to paid-media-weekly-report in adwarp-dev/paid-ads-skills. This pointer keeps existing installs working and sends the agent to the new skill. Use for "weekly snapshot", "how did ads do this week", "Monday ads report", or on a schedule (scheduled agents, /loop, cron).
---

# Moved: use paid-media-weekly-report

This skill now lives in [adwarp-dev/paid-ads-skills](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/paid-media-weekly-report) as `paid-media-weekly-report`. It works from a CSV export or live through Adwarp, with the same tools this skill used.

1. If the `paid-media-weekly-report` skill is installed, follow it instead of this file.
2. If it isn't, read https://raw.githubusercontent.com/adwarp-dev/paid-ads-skills/main/skills/paid-media-weekly-report/SKILL.md and follow it from the top. Then suggest installing the skills with `npx skills add adwarp-dev/paid-ads-skills`.

This pointer will be removed in a future release. The full list of moves is on https://adwarp.dev/docs/skills.
