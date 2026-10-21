# Skills moved

Adwarp's skills now live in [adwarp-dev/paid-ads-skills](https://github.com/adwarp-dev/paid-ads-skills): 17 skills for LinkedIn Ads and Google Ads that run from a CSV export or live through Adwarp.

```bash
npx skills add adwarp-dev/paid-ads-skills
```

The `adwarp-*` folders here are pointers, kept so existing installs keep working. Each one sends the agent to the skill that replaced it:

| Old name | New name |
| --- | --- |
| `adwarp-account-audit` | `linkedin-ads-audit` |
| `adwarp-performance` | `linkedin-ads-performance-review` |
| `adwarp-spend` | `linkedin-ads-spend-analysis` |
| `adwarp-leads` | `linkedin-ads-lead-drivers` |
| `adwarp-audiences` | `linkedin-audience-ops` |
| `adwarp-launch` | `linkedin-campaign-launch` |
| `adwarp-competitors` | `linkedin-ad-library-teardown` |
| `adwarp-gads-launch` | `google-ads-search-campaign-builder` |
| `adwarp-weekly` | `paid-media-weekly-report` |
| `adwarp-health` | `paid-media-health-check` |
| `adwarp-experiments` | `ad-experiment-lift` |

The `liam-*` and `gads-launch` links point at the same pointers. All of them will be removed in a future release. To switch now, install the new skills, then remove the old `adwarp-*`, `liam-*` and `gads-launch` links from `~/.claude/skills`.

New skills and fixes go to the [paid-ads-skills contributing guide](https://github.com/adwarp-dev/paid-ads-skills/blob/main/CONTRIBUTING.md).
