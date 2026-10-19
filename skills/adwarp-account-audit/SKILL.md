---
name: adwarp-account-audit
description: Quarterly hygiene review of a LinkedIn ads account via Adwarp. Naming conventions, conversion wiring, safety toggles, targeting overlap between active campaigns, leftover drafts, landing-page and UTM consistency, and untracked changes. Use for "audit my account", "account hygiene check", "review my account setup", "is my account set up right".
---

# Adwarp: account audit

A setup review, not a performance review (that is adwarp-performance). The output is a
scorecard: pass, flag, or fail per area, each verdict carrying its evidence, followed
by a ranked fix list. Run it quarterly or when inheriting an account.

## How to reach Adwarp

Prefer the Adwarp MCP tools: `list_campaigns` (drafts included), `list_ads`,
`list_conversions`, `list_ad_changes`, and a light `get_performance` pass to see what
is actually spending. Where Adwarp does not expose a field (some toggles and
associations are only visible in Campaign Manager), put it on the manual checklist at
the end rather than skipping it silently.

## Areas

1. **Structure and naming.** Does the tree read sensibly at each level? Do names
   encode audience, persona, or offer (the analysis skills mine angles from names,
   so opaque names cost real capability)? Duplicated or near-duplicate campaigns,
   archived clutter.
2. **Draft debt.** Draft groups, campaigns, and ads older than ~2 weeks. Ship them
   or delete them; stale drafts hide real intent.
3. **Conversion wiring.** `list_conversions` for what exists; every active campaign
   should be associated with the right conversion. Campaigns tracking nothing, or
   tracking a legacy conversion, are flags. Multiple near-duplicate conversions in
   the account are themselves a flag.
4. **Safety toggles.** Audience Expansion off and Audience Network off is the sane
   default for targeted B2B accounts; confirm where readable, otherwise send to the
   manual checklist.
5. **Targeting overlap.** Active campaigns whose targeting resolves to substantially
   the same audience bid against each other in the auction. List overlapping pairs
   and which one should own the audience.
6. **Landing pages and UTMs.** Ad landing URLs resolve, use https, and carry
   consistent UTM parameters (source, medium, campaign) so downstream attribution
   holds. Inconsistent or missing UTMs on some ads is the most common silent leak.
7. **Journal coverage.** Entities with meaningful spend but no journaled changes
   mean edits are happening untracked (usually directly in Campaign Manager);
   recommend the adwarp-experiments logging discipline.

## Report format

- **Scorecard:** area, verdict (pass / flag / fail), 1 line of evidence.
- **Fix list:** ranked by impact, each with the concrete step and rough effort.
- **Manual checklist:** everything only visible in Campaign Manager, phrased so the
  user can verify each item in under a minute.
