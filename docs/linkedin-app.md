---
title: Create a LinkedIn app
description: "Set up the LinkedIn developer app Adwarp runs against: products to request, the redirect URL, ad account mapping, and OAuth scopes."
order: 2
---

Adwarp runs against your own LinkedIn developer app, so your credentials and your ad account stay yours. You do this once, before either install path.

1. Create an app at [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps). It must be associated with your company's LinkedIn Page.
2. On the Products tab, request access to the products below.
3. On the Auth tab, add `http://localhost:53682/callback` as an authorized redirect URL, and note your Client ID and Client Secret.
4. Once the Advertising API is approved, map your ad account under Products > Advertising API > View Ad Accounts. Skip this and `adwarp accounts list` comes back empty.

## Products

| Product | Needed for | Required? |
| --- | --- | --- |
| Advertising API | campaigns, ads, targeting, reporting, conversions | Yes |
| Audiences | uploading CSV contact and company lists as matched audiences | Only for audience upload |
| LinkedIn Ad Library | competitor ad metadata through the official API | Only for competitor ads, which have no browser fallback |

## OAuth scopes

`adwarp auth login` requests these scopes:

| Scope | Used for |
| --- | --- |
| `rw_ads` | creating and editing campaigns |
| `r_ads_reporting` | reporting |
| `rw_conversions` | conversion tracking |
| `w_organization_social` | image ads, which create a post owned by your LinkedIn Page |

If you add a product or scope later, run `adwarp auth login` again. A token refresh keeps only the scopes you originally granted.

Next: [build Adwarp and authenticate](./install.md).
