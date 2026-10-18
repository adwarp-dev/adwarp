---
title: Safety
description: "The rules Adwarp follows so nothing spends without you: draft-only creation, audience limits, and where secrets live."
order: 12
---

- Every LinkedIn campaign and creative is created as a DRAFT, and every Google Ads campaign, ad group, and ad as PAUSED. Activation is a separate, explicit step you take yourself in Campaign Manager or in Google Ads.
- Matched-audience matching takes up to 48 hours, and a campaign needs about 300 matched members to serve.
- LinkedIn does not expose person-level ad view data, so cross-referencing is at the account and segment level.
- Secrets never enter the repo. Locally they live in `~/.liads`. Hosted, they live in your Vercel environment variables, or in request headers you control.
- The hosted endpoint never registers the Google Ads tools, so no caller can reach the Google Ads account a server is configured with.
