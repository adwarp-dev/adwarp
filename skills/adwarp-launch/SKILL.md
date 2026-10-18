---
name: adwarp-launch
description: Create LinkedIn campaigns through Adwarp with guardrails, from a plain-language ask to a confirmed brief to draft campaign group, campaign, and ads. Applies house defaults (audience expansion and Audience Network off, standing exclusions, conversion wiring, create-only format fields) so the draft is right the first time. Use for "launch a campaign", "set up a campaign for", "create ads for", "spin up an ABM campaign".
---

# Adwarp: guarded campaign launch

Everything Adwarp creates is a DRAFT and goes live only when the user explicitly asks, so
the cost of a mistake is rework, not money. This skill's job is making rework rare: gather
a complete brief, estimate before creating, apply the house rules, confirm, create,
verify.

## How to reach Adwarp

Prefer the Adwarp MCP tools if loaded: `launch_from_brief`, `create_campaign_group`,
`create_campaign`, `create_image_ad`, `search_targeting`, `list_targeting_facets`,
`estimate_audience`, `list_conversions`, `upload_audience_csv`,
`audience_from_salesforce`. CLI fallback: `adwarp launch --brief brief.json` (see
`examples/brief.json` in the Adwarp repo). Naming map: campaignGroupName is LinkedIn's
"campaign", campaignName is the "ad group", creatives are the "ads".

## Step 1: gather the brief

Required before anything is created: group and campaign names, daily budget and bid
(with currency), landing URL, run start (epoch ms, must be in the future), the
audience (a matched-list CSV, a Salesforce SOQL query, or targeting facets), and the
ad copy or enough intent to draft it. Name entities so the angle is legible (persona,
offer, competitor, audience in the name); the analysis skills mine angles from names
later.

## Step 2: resolve and estimate before creating

- Resolve targeting facets with `search_targeting`; verify facet names with
  `list_targeting_facets` (they are exact; job functions is `jobFunctions`, not
  `functions`).
- `estimate_audience` on the resolved spec and quote the reach in the confirmation.
- Matched audiences need ~300 members to serve at all; warn below that, and note
  matching takes up to 48h, so the run start should allow for it.
- CSV audiences: always `--dry-run` first and show the cleaned columns and row count
  before uploading.

## Step 3: apply the house rules

Ask once for the account's standing defaults if you do not know them, then apply on
every campaign:

- **Audience Expansion off** and **LinkedIn Audience Network off**. Where Adwarp does
  not expose a toggle at creation, list it as a Campaign Manager check in the handoff
  rather than assuming.
- **Standing exclusion audiences** (customers, competitors, employees are the usual
  set) on every campaign.
- **Conversion tracking wired**: use the user's named conversion or the config
  default (`conversionName`/`conversionIds`; `list_conversions` to look up). Never
  create a campaign that tracks nothing.
- **Format is create-only.** A video campaign must be created with format
  SINGLE_VIDEO; format cannot be patched afterwards. Getting this wrong means
  recreating the campaign.
- Sponsoring somebody else's post takes the ENGAGEMENT objective.
- **Ad rotation** is the campaign field `creativeSelection`: `OPTIMIZED` (LinkedIn's
  default, favors the predicted winner) or `ROUND_ROBIN` (Campaign Manager's "Rotate ads
  evenly"). Small audiences with several ads per ad set usually want `ROUND_ROBIN` so every
  ad gets a fair read. Set it on `create_campaign` / `update_campaign`, in a brief, or with
  `adwarp campaigns update <id> --rotation even --apply`.

## Step 4: confirm, then create

Show the assembled brief (names, budget, bid, schedule, audience and its estimated
reach, exclusions, conversion, format) and create only after the user confirms.
`launch_from_brief` is not transactional: if a mid-flight step fails it can leave an
orphan campaign group, so on failure report exactly what got created and either clean
it up or reuse it on retry.

## Step 5: verify and hand off

- `list_campaigns` to confirm the tree exists as intended; report every id.
- Image ads need the `w_organization_social` scope, an organization-owned image, and
  a DSC post; the landing URL field is `contentLandingPage`. If scopes are missing,
  a fresh `auth login` is required (token refresh keeps only the original scopes).
- Journal the launch hypothesis with `log_ad_change` and a label, so
  adwarp-experiments can measure it later.
- Hand off activation. It happens only on the user's explicit request, through Adwarp
  or in Campaign Manager, never as part of the launch itself. Order matters: group
  first, then campaigns, then creatives (LinkedIn rejects activating a child under a
  DRAFT parent).
