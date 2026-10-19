---
title: HubSpot audiences
description: "Turn a HubSpot list or a CRM search into a LinkedIn matched audience, using a read-only private app token from your own HubSpot account."
order: 12
---

Adwarp reads contacts and companies from HubSpot with a private app access token that you create in your own HubSpot account. The token only needs read scopes, and Adwarp never writes to HubSpot.

Point it at a HubSpot list, or describe the records with search filters, and the result becomes a matched audience, closing the loop from "the accounts we track in HubSpot" to "LinkedIn targeting". The `audience_from_hubspot` tool and the `adwarp audience from-hubspot` command do the same thing:

```bash
adwarp audience from-hubspot -n "Q3 target accounts" --list 123 --dry-run
adwarp audience from-hubspot -n "Q3 target accounts" --list 123
```

## What it does

- Reads every record: all pages of a list's members, or all pages of a search.
- Contacts become a contact list, matched on email. Adwarp reads only the `email` property, then trims and lowercases it, drops blank, malformed and duplicate addresses, and SHA-256 hashes the rest. Only the hashes leave your machine.
- Companies become a company list, matched on name and website. Adwarp reads `name` and `domain` and turns each domain into an `https://` website URL.
- The records go through the same cleaning, hashing and upload as [`upload_audience_csv`](./tools.md#audiences), so a HubSpot list and the same list exported to a CSV produce the same audience.
- It reports the records read, how many are valid, how many uploaded, and how many were skipped and why: no email, invalid email, duplicate email, no name or domain, or a list member that no longer exists in HubSpot.

Always run it with `--dry-run` (or `dryRun: true` on the tool) first. A dry run reads HubSpot, shows the counts and a sample of 5 cleaned rows, and uploads nothing. Contact emails in the sample are masked, as in `ad***@example.com`, next to the SHA-256 hash that would upload.

## Create the private app

HubSpot lists these under legacy apps, and creating one takes a super admin.

1. In HubSpot, go to **Development**, then click **Legacy apps** in the left sidebar.
2. Click **Create legacy app**, then choose **Private**.
3. Give it a name, such as "Adwarp audiences".
4. On the **Scopes** tab, click **Add new scope** and select these 3 read scopes:
   - `crm.objects.contacts.read`
   - `crm.objects.companies.read`
   - `crm.lists.read`
5. Click **Create app**.
6. On the app's **Auth** tab, click **Show token**, then copy it.

Add no other scopes. Adwarp only reads, so a token with read scopes alone is all it needs.

## Where the token goes

Save the token in `~/.adwarp/hubspot.json`, next to your other Adwarp credentials:

```json
{ "accessToken": "your-private-app-token" }
```

Then make the file readable only by you:

```bash
chmod 600 ~/.adwarp/hubspot.json
```

Or set the `ADWARP_HUBSPOT_TOKEN` environment variable wherever the MCP server or the CLI runs. When both are set, the environment variable wins. If your install still uses the `~/.liads` folder from before the rename, the file goes there instead.

HubSpot recommends rotating a private app token every 6 months, from the app's **Auth** tab. Update the file or the variable when you do.

## Examples

From a list. HubSpot now calls lists segments: to find a list's id, open **Segments** in HubSpot, hover over the list, and click **Details**. A contact list builds a contact audience and a company list builds a company audience, so `-t` is optional here:

```bash
adwarp audience from-hubspot -n "Open opportunities" --list 123 --dry-run
```

From a search. Each `--filter` is `<property>:<operator>:<value>`, using the property's internal name in HubSpot, and every filter must match. A search builds a contact audience unless you pass `-t company`:

```bash
adwarp audience from-hubspot -n "Marketing qualified leads at acme.com" \
  --filter lifecyclestage:EQ:marketingqualifiedlead \
  --filter "email:CONTAINS_TOKEN:*@acme.com" --dry-run

adwarp audience from-hubspot -n "Large accounts" -t company \
  --filter annualrevenue:GT:10000000 --dry-run
```

The operators are HubSpot's: `EQ`, `NEQ`, `LT`, `LTE`, `GT`, `GTE`, `BETWEEN`, `IN`, `NOT_IN`, `HAS_PROPERTY`, `NOT_HAS_PROPERTY`, `CONTAINS_TOKEN` and `NOT_CONTAINS_TOKEN`. `IN` and `NOT_IN` take a comma-separated list, `BETWEEN` takes `low,high`, and `HAS_PROPERTY` and `NOT_HAS_PROPERTY` take no value (`email:HAS_PROPERTY`). For `IN` on a text property, HubSpot expects the values in lowercase.

Through the MCP tool, the same search is:

```json
{
  "name": "Marketing qualified leads at acme.com",
  "filters": [
    { "property": "lifecyclestage", "operator": "EQ", "value": "marketingqualifiedlead" },
    { "property": "email", "operator": "CONTAINS_TOKEN", "value": "*@acme.com" }
  ],
  "dryRun": true
}
```

Pass `accountId` to choose the ad account, or leave it out to use `defaultAccountId` from your [config](./config.md).

## Limits

- **10,000 records per search.** HubSpot's search returns at most 10,000 results for a query, so a broader search stops with an error before anything uploads. Narrow the filters, or save the records as a HubSpot list and use `--list`, which has no such cap.
- **6 filters, all ANDed.** HubSpot allows up to 6 filters in a group. For OR logic, build a list in HubSpot and use that.
- **Request pacing.** HubSpot's search allows 5 requests per second, and a private app gets 100 requests every 10 seconds on Free and Starter. Adwarp paces itself under both and retries when HubSpot answers 429. A list is read 100 members per page and 100 records per batch, so a 300,000 member list takes about 6,000 requests, or roughly 10 minutes.
- **Contacts match on their primary email.** Additional email addresses on a contact are not read.
- **Matched audience rules.** These are the same as any upload: at most 300,000 rows per list, at least 10,000 contacts or 1,000 companies recommended, and about 300 matched members before a campaign can serve. Matching takes up to 48 hours.
- **Refreshing.** Each run creates a new segment. To refresh an audience, run it again and swap the new segment into the campaign's targeting.
- **Local only.** This runs through the local MCP server or the CLI, never the [hosted endpoint](./hosted.md), which does not register the tool. A token stored on a shared server would let any caller read that HubSpot account.

This needs the Audiences product on your [LinkedIn app](./linkedin-app.md). Adwarp calls HubSpot's date-versioned API, version `2026-09`.
