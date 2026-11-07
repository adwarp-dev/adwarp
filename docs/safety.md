---
title: Safety
description: "The rules Adwarp follows so nothing spends without you: drafts-first creation, audience limits, and where secrets live."
order: 13
---

- Every LinkedIn campaign and creative is created as a DRAFT by default, and every Google Ads campaign, ad group, and ad as PAUSED. On LinkedIn, going live is always an explicit request: you ask Adwarp to set a campaign or a single ad ACTIVE, or switch it on yourself in Campaign Manager. On Google, no create schema can express an enabled status, so activation happens in the Google Ads UI.
- Every LinkedIn ad set Adwarp creates has LinkedIn Audience Network and Audience Expansion turned off. LinkedIn turns both on for new ad sets in Campaign Manager. Audience Network shows ads on other apps and sites, and Audience Expansion reaches people outside the audience you picked. No Adwarp tool turns either back on, so they only change if you switch them on in Campaign Manager.
- Pausing a single ad (`update_ad`, or `adwarp ad pause`) only stops its spend. Setting an ad `ACTIVE` starts it, so the tool's description tells your assistant to do that only when you explicitly ask, and the CLI previews every ad status change until you add `--apply`.
- Deleting an ad (`delete_ad`, or `adwarp ad delete`) deletes the post behind it only when that post is Direct Sponsored Content from the same ad account. A member's post behind a thought leader ad, or an organic Page post, stays in place.
- Matched-audience matching takes up to 48 hours, and a campaign needs about 300 matched members to serve.
- LinkedIn does not expose person-level ad view data, so cross-referencing is at the account and segment level.
- Secrets never enter the repo. Locally they live in `~/.adwarp`. Hosted, they live in your Vercel environment variables, or in request headers you control.
- The hosted endpoint never registers the Google Ads tools, so no caller can reach the Google Ads account a server is configured with.
