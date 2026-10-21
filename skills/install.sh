#!/usr/bin/env bash
# Adwarp's skills moved to github.com/adwarp-dev/paid-ads-skills. This script used to link the adwarp-* skills
# into ~/.claude/skills; those folders are now pointers to the new skills, so existing links keep working.
set -euo pipefail

cat <<'MSG'
Adwarp's skills moved to github.com/adwarp-dev/paid-ads-skills (17 skills for LinkedIn Ads and Google Ads).

Install them with:

  npx skills add adwarp-dev/paid-ads-skills

Or, in Claude Code:

  /plugin marketplace add adwarp-dev/paid-ads-skills
  /plugin install paid-ads-skills@adwarp

Links this script made earlier still work: the old adwarp-* folders point to the new skills.
Once the new skills are installed, you can remove the old adwarp-*, liam-* and gads-launch links
from ~/.claude/skills.
MSG
