---
title: Skills
description: "Portable agent skills that turn Adwarp's raw tools into opinionated playbooks for analysis, monitoring, and launching."
order: 8
---

The [skills directory](https://github.com/adwarp-dev/adwarp/tree/main/skills) ships 11 portable agent skills that turn Adwarp's raw tools into opinionated workflows. Each encodes a methodology: what to pull, how to judge it, significance floors, caveats, and a fixed report format. They work over the MCP tools or the CLI.

Analysis and monitoring skills are read-only. The operating skills create drafts (or paused Google entities) only, after confirmation.

## Analyze

| Skill | Ask it | What you get |
| --- | --- | --- |
| `adwarp-spend` | "Analyze my spend" | budget concentration, wasted spend, reallocation moves |
| `adwarp-performance` | "How are my ads doing?" | winners, losers, fatigue, actions |
| `adwarp-leads` | "Which ads drive leads, which don't?" | drivers, a pause list, copy angle patterns |
| `adwarp-competitors` | "What is `<company>` running?" | an Ad Library teardown and gaps |

## Monitor

| Skill | Ask it | What you get |
| --- | --- | --- |
| `adwarp-weekly` | "Weekly snapshot" | a fixed-format week-over-week digest, schedule-friendly |
| `adwarp-health` | "Anything on fire?" | silent-unless-fire daily guardrails, 1 line when all is clear |

## Operate

| Skill | Ask it | What you get |
| --- | --- | --- |
| `adwarp-launch` | "Launch a campaign" | a brief turned into a confirmed draft, with house guardrails applied |
| `adwarp-experiments` | "Did that change help?" | hypothesis logging plus before and after lift |
| `adwarp-audiences` | "Audit my audiences" | health, dry-run uploads, Salesforce and HubSpot refresh loops |
| `adwarp-account-audit` | "Is my account set up right?" | a hygiene scorecard and fix list |

## Google Ads

| Skill | Ask it | What you get |
| --- | --- | --- |
| `adwarp-gads-launch` | "Launch a Google search campaign for..." | keyword research with volume and bid ranges, house guardrails, a server-side dry run, a confirmed paused campaign |

## Install

```bash
./skills/install.sh          # symlinks each skill into ~/.claude/skills (Claude Code personal skills)
./skills/install.sh --copy   # copies instead, if you prefer no symlinks
```

Symlinks keep the skills in lockstep with the repo, so a `git pull` updates them in place. Restart your Claude Code session afterwards so it discovers the new skills. Set `CLAUDE_SKILLS_DIR` to install somewhere other than `~/.claude/skills`.

Installed the skills before the rename? The old `liam-*` and `gads-launch` names stay in the repo as links to the renamed skills, so your install keeps working. Run `./skills/install.sh` again to switch it to the `adwarp-*` names.

To build your own playbook for the [hosted endpoint](./hosted.md#put-a-skill-on-top), copy a skill and swap in your defaults. Credentials never belong in a skill file.
