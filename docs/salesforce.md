---
title: Salesforce audiences
description: "Turn a Salesforce SOQL query into a LinkedIn matched audience, using your existing sf CLI login."
order: 11
---

Adwarp reads Salesforce by shelling out to the authenticated `sf` CLI (`sf data query`), so it reuses your existing login and needs no new credentials. It is read-only.

Give it a SOQL query that selects an email column and the result becomes a matched audience, closing the loop from "accounts flagged in Salesforce" to "LinkedIn targeting". The `audience_from_salesforce` tool and the `adwarp audience from-salesforce` command do the same thing:

```bash
adwarp audience from-salesforce -n "Q3 target accounts" \
  -q "SELECT Email FROM Contact WHERE Account.Target_List__c = true AND Email != null"
```

If the email column is not named `Email`, pass `--email-field <column>` (or `emailField` to the tool).

Matching follows the same rules as any matched audience: it takes up to 48 hours, and a campaign needs about 300 matched members to serve. This needs the Audiences product on your [LinkedIn app](./linkedin-app.md), and it runs through the local MCP server or the CLI, since the hosted endpoint has no `sf` CLI.
