---
name: adwarp-competitors
description: Research any company's LinkedIn ads through Adwarp's Ad Library integration and synthesize how their account is run. Messaging themes, offers and CTAs, format mix, cadence, EU impression and targeting data, plus gaps worth exploiting. Single competitor or side-by-side. Use for "what ads is X running", "research competitors", "competitor ad teardown", "compare our ads to theirs".
---

# Adwarp: competitor ad research

The deliverable is a strategy read, never the ad list itself. Read the copy, formats,
targeting, and cadence, then explain how the competitor runs their account and what
that means for the user's own ads.

## How to reach Adwarp

Prefer the Adwarp MCP tool `inspect_competitor_ads` if loaded. Otherwise the CLI:
`adwarp competitor ads <advertiser>` (or `npx -y adwarp
competitor ads ...`). No ad-account access is needed; this reads the public LinkedIn
Ad Library.

## Getting the right ads

- **Name plus company id.** Name searches include unrelated advertisers. Supply both
  advertiser name and verified numeric companyId. The API searches by name and Adwarp
  filters the returned advertiser URL before queuing any creative work. Example:
  `adwarp competitor ads Ramp --company-id 1406226 --max 100 --copy-max 10 --json`.
  Total reported is the broad API query total, not an exact-company or active-ad count.
- **Engines.** `api` returns metadata. `auto` adds cached copy/screenshots from a remote
  creative worker or queues missing ads. Local scraping is disabled, including fallback.
  Configure ADWARP_CREATIVE_WORKER_URL and ADWARP_CREATIVE_WORKER_TOKEN on the CLI/MCP host.
- **Coverage.** Read up to 10 sampled creatives. Pending work is asynchronous: use
  `get_competitor_creatives` with IDs, or `adwarp creative-status id1,id2`, to check it.
  Status reads never visit LinkedIn or enqueue more work. Poll at reasonable intervals.
  Do not rerun discovery just to wait for copy. Report collection dates, sample coverage,
  missing copy, and whether a screenshot is a preview rather than a complete video.
  Screenshot paths require worker authentication; do not put tokens in URLs or reports.
- **Cache.** The worker adds a seven-day creative cache automatically. Existing temporary
  JSON exports are not imported automatically. Repeated ad IDs reuse jobs and cached results.
- **Blocks and outages.** If the worker is blocked, stop. Do not probe LinkedIn via another
  browser, curl, fetch, proxy or network. Never override worker limits, clear its state or
  resume it without explicit operator authorization. Return available metadata/cached data.
  If no worker is configured, say creative collection is unavailable; do not scrape locally.
- **EU bonus data.** Ads served in the EU carry run dates, impression ranges,
  per-country splits, and structured targeting facets. Use them; they are the closest
  thing to seeing a competitor's media plan.

## Synthesis framework

Work through these dimensions and ground every claim in specific ads (quote short copy
snippets):

1. **Messaging themes.** The 2-4 recurring value props or narratives across the ads.
2. **Offers and CTAs.** What they ask for: demo, trial, report, webinar, event. The
   offer mix reveals which funnel stage they are buying.
3. **Format mix.** Single image vs video vs carousel vs document vs thought-leader
   ads, roughly proportioned.
4. **Who they spotlight.** Executives, customers, partners, product screenshots.
5. **Cadence and scale.** How many ads run concurrently, how often new ones ship
   (run dates where available), impression volume and geography.
6. **Targeting** (EU data where present): languages, locations, company and job
   facets, notable exclusions.

## Comparing several competitors

Run each pull separately, then produce one comparison: a table across the dimensions
above, then a strategic read of who spends hardest, whose positioning overlaps the
user's, and which offer types nobody in the set is running.

## Report format

- **How they run it:** one paragraph per competitor summarizing the account strategy.
- **Dimension findings:** themes, offers, formats, spotlight, cadence, targeting, each
  with example ads quoted.
- **So what:** implications for the user's own account. Over-used angles to avoid,
  gaps worth testing, offers worth copying, formats they are ignoring. Make these
  specific enough to brief an ad from.
