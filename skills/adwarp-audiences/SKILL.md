---
name: adwarp-audiences
description: Audit and operate LinkedIn matched audiences with Adwarp. Inventory and health checks (stuck matching, under 300 members, stale, orphaned), disciplined CSV uploads with dry runs, and the Salesforce-to-audience refresh loop. Use for "audit my audiences", "audience status", "upload this list", "refresh the audience from Salesforce", "why isn't this audience serving".
---

# Adwarp: audience ops

Most "retargeting is not working" and "campaign will not serve" problems are audience
problems. This skill keeps the matched-audience layer healthy: what exists, what state
it is in, and how lists get in and stay fresh.

## How to reach Adwarp

Prefer the Adwarp MCP tools if loaded: `get_audience_status`, `upload_audience_csv`,
`audience_from_salesforce`, `list_campaigns`, `list_ad_changes`. CLI: `adwarp audience
status <segmentId>`, `adwarp audience upload`, `adwarp audience from-salesforce`.

## Inventory

Adwarp has no list-all-segments call, so assemble the inventory honestly from three
sources: the change journal (`list_ad_changes` records every segment Adwarp created,
with dates), campaign targeting where `list_campaigns` exposes attached audiences,
and the user's own knowledge. Say explicitly when the inventory may be incomplete.

## Health checks, per audience

1. **Status.** Matching takes up to 48h; still matching beyond that is a finding.
2. **Size.** Under ~300 matched members the audience will not serve at all. Between
   300 and ~1,000 it serves but is unstable and fatigues fast; note it.
3. **Staleness.** Use the journal's creation date. A contact list from a quarter ago
   has decayed (people change jobs at B2B rates of ~3% a month); recommend a refresh
   cadence of monthly for active lists, quarterly at minimum.
4. **Orphans.** Segments attached to no campaign are clutter or forgotten intent;
   propose attaching or retiring them.
5. **Fatigue signal.** A small audience plus week-over-week CTR decline on the
   campaigns using it means the same people are seeing tired creative; fix with new
   creative or a bigger list.

## Upload discipline

Always `--dry-run` first and show the cleaned columns and row count before uploading
anything. Adwarp auto-cleans: normalizes column names, drops non-matcher columns,
hashes emails, converts company domains to website URLs, and auto-detects contact vs
company lists. Warn on anything under 300 rows: it will never serve.

## The Salesforce loop

`audience_from_salesforce` turns a SOQL email query (via the authed `sf` CLI) into a
matched audience in one step. Refreshing means re-running the query, which produces a
fresh segment: report the new segment id, and note that swapping it into an existing
campaign's targeting happens at campaign creation or in Campaign Manager. Retire the
old segment from the inventory once the swap is done. Suggest journaling the swap
(`log_ad_change`) so lift analysis can see it.

## Report format

- **Verdict:** one line on overall audience health.
- **Table:** audience, status, size, age, attached campaigns, flag.
- **Actions:** refreshes to run (with the SOQL or CSV source), attachments or
  retirements, anything blocked waiting on LinkedIn matching.
