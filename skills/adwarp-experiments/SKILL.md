---
name: adwarp-experiments
description: Moved to ad-experiment-lift in adwarp-dev/paid-ads-skills. This pointer keeps existing installs working and sends the agent to the new skill. Use for "did that change help", "measure the lift", "log this test", "what tests are running", "was the new headline better".
---

# Moved: use ad-experiment-lift

This skill now lives in [adwarp-dev/paid-ads-skills](https://github.com/adwarp-dev/paid-ads-skills/tree/main/skills/ad-experiment-lift) as `ad-experiment-lift`. It works from a CSV export or live through Adwarp, with the same tools this skill used.

1. If the `ad-experiment-lift` skill is installed, follow it instead of this file.
2. If it isn't, read https://raw.githubusercontent.com/adwarp-dev/paid-ads-skills/main/skills/ad-experiment-lift/SKILL.md and follow it from the top. Then suggest installing the skills with `npx skills add adwarp-dev/paid-ads-skills`.

This pointer will be removed in a future release. The full list of moves is on https://adwarp.dev/docs/skills.
