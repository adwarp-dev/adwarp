---
title: Safety
description: "The rules Adwarp follows so nothing spends without you: drafts-first creation, audience limits, and where secrets live."
order: 13
---

- Every LinkedIn campaign and creative is created as a DRAFT by default, and every Google Ads campaign, ad group, and ad as PAUSED. On LinkedIn, going live is always an explicit request: you ask Adwarp to set a campaign or a single ad ACTIVE, or switch it on yourself in Campaign Manager. On Google, no create schema can express an enabled status, so activation happens in the Google Ads UI.
- Pausing a single ad (`update_ad`, or `adwarp ad pause`) only stops its spend. Setting an ad `ACTIVE` starts it, so the tool's description tells your assistant to do that only when you explicitly ask, and the CLI previews every ad status change until you add `--apply`.
- Matched-audience matching takes up to 48 hours, and a campaign needs about 300 matched members to serve.
- LinkedIn does not expose person-level ad view data, so cross-referencing is at the account and segment level.
- Secrets never enter the repo. Locally they live in `~/.adwarp`. Hosted, they live in your Vercel environment variables, or in request headers you control.
- The hosted endpoint never registers the Google Ads tools, so no caller can reach the Google Ads account a server is configured with.
