---
name: adwarp-experiments
description: Run disciplined ad tests with Adwarp's change journal and lift analysis. Log a hypothesis before a change, measure before vs after with compute_lift, and read results with the confounds stated. Use for "did that change help", "measure the lift", "log this test", "what tests are running", "was the new headline better".
---

# Adwarp: experiments and lift

Ad accounts accumulate changes nobody can evaluate later because nobody wrote down
what changed and why. Adwarp journals every change it makes automatically; this skill
adds the discipline around it: hypotheses going in, honest verdicts coming out.

## How to reach Adwarp

Prefer the Adwarp MCP tools if loaded: `log_ad_change`, `list_ad_changes`,
`compute_lift`. CLI: `adwarp changelog list`, `adwarp changelog add`, `adwarp lift <level>
<entityId> [-w days]`. The journal lives at `~/.adwarp/changelog.jsonl`. Changes made
directly in Campaign Manager are invisible until logged by hand; that is the most
common reason a lift read comes back empty.

## Starting a test

1. **Hypothesis first**, 1 sentence: "outcome-led headline will beat feature-led on
   cost per conversion."
2. **Make the change.** Copy changes on LinkedIn are recreate, not edit
   (`delete_ad` + `create_image_ad`, drafts, user confirms deletes); Adwarp journals
   these automatically. Changes made in Campaign Manager get `log_ad_change` with the
   entity, field, and after-value.
3. **Label it** (`-l "outcome-led headline test"`) and tag related changes so the
   test reads as 1 unit.
4. **1 change per entity at a time** where possible. 2 simultaneous changes on
   the same entity cannot be separated afterwards; if it happened anyway, say so in
   the read-out.

## Reading a test

`compute_lift` compares the window before each recorded change against the same
window after (default 14 days) and reports per-metric deltas: CTR, CPC, conversions,
conversion rate, cost per conversion.

Rules for an honest read:

- **Wait for volume, not just days.** No verdict without ~1,000 impressions or a few
  conversions on each side; otherwise report "inconclusive, recheck on <date>".
- A `partial` after-window means the change is recent; present it as interim.
- **State the confounds every time:** seasonality, LinkedIn's learning phase
  restarting after an edit (early post-change days usually dip), concurrent budget or
  audience changes. This is a directional pre/post comparison, never proof.
- Verdicts are exactly 1 of: better, worse, inconclusive.

## The test registry

When asked "what tests are running", `list_ad_changes` is the answer: recent changes
still inside their after-window (open tests), completed windows nobody has read yet,
and unlabeled changes worth labeling before they are forgotten.

## Report format

Per change: label, date, entity, before vs after on the 4 or 5 KPIs that
matter, verdict, confounds. Close with 1 portfolio line: what the wins suggest
testing next.
