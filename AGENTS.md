# AGENTS.md

Guidance for AI agents and contributors working in this repo. Adwarp (formerly Liam) is an
MCP server and CLI that creates ad campaigns on LinkedIn and Google Ads. Read this before
changing code.

## Architecture

pnpm + TypeScript monorepo:

- `packages/shared` — the platform-neutral layer: OAuth flow, credential stores, retry
  policy, the change journal and its lift windowing, named reporting periods, and the KPI
  math every platform shares. Anything here must be true of both platforms; anything true
  of only one belongs in that platform's package.
- `packages/core` — the LinkedIn engine. No UI. Owns the LinkedIn REST client, every
  resource module, audience hashing, targeting, conversions, and the Salesforce reader.
- `packages/google` — the Google Ads engine. Same shape as core: config and auth, one HTTP
  chokepoint, thin typed resource modules over GAQL, zod schemas reused as MCP inputs.
- `packages/mcp` — MCP server. `src/tools.ts` (LinkedIn) and `src/googleTools.ts`
  (`gads_*`) are shared by the stdio entry (`src/index.ts`) and the hosted Vercel route.
- `packages/cli` — the `adwarp` CLI (commander), also installed as `liam` for existing users.
  LinkedIn at the top level, Google under `adwarp google ...` (`src/google.ts`).
- `packages/adwarp`: the published npm package `adwarp`. `build.mjs` bundles the private
  `@liads/*` packages with esbuild into `dist/cli.js` (`adwarp`, `liam`) and `dist/mcp.js`
  (`adwarp-mcp`). Third-party imports stay npm dependencies, and the build fails on one its
  package.json does not declare. `scripts/smoke.mjs` tests the packed tarball and the root
  `Dockerfile`'s image. The release version lives in its package.json and in
  `packages/shared/src/version.ts`, and the build fails when the 2 differ.
- `apps/web` — Next.js app hosting the MCP over HTTP at `/api/mcp` (Vercel). Two tenants:
  the env-credential tenant gated by a `MCP_AUTH_TOKEN` bearer, and bring-your-own
  credentials callers who send `X-Liads-*` headers (client id/secret + refresh token,
  optional account id/version) that the route activates per request via
  `withRequestCredentials` (core/config.ts, AsyncLocalStorage).

Data flow: every tool/command builds a client via `createLiads()` (core/client.ts), which
loads config + an auto-refreshing token provider, then calls a resource module. Resource
modules are thin typed wrappers over `LinkedInClient.request()`.

## Conventions

- **Nothing is ever created live.** On LinkedIn, campaigns, campaign groups, and creatives
  default to `DRAFT`/`intendedStatus: DRAFT`. On Google, which has no draft status, campaigns,
  ad groups, and ads are created `PAUSED` and the schemas cannot express any other status.
  Never change either default. Activation is a separate, explicit, human step, and there is
  deliberately no tool for it on either platform.
- **zod schemas are the source of truth.** All tool/command inputs live as zod schemas in
  `core/src/schemas.ts` and are reused as MCP tool input schemas (`Schema.shape`). Add or
  change a field there first, then thread it through the resource module.
- **Secrets never enter the repo.** Local credentials live in `~/.liads/` (LinkedIn:
  `config.json` + `credentials.json`; Google: `google.json` + `google-credentials.json`,
  all mode 0600). Hosted credentials are `LIADS_*` / `GADS_*` env vars, or per-request
  `X-Liads-*` headers for bring-your-own-credentials callers. The config layer resolves
  request context first, then env, then files. Never log header credentials.
- **The hosted MCP does not expose the Google tools**, and must not start doing so. That
  endpoint is multi-tenant over per-request LinkedIn credentials while Google credentials
  would come from shared server env vars, so exposing them would let any caller operate the
  server's Google Ads account. `registerTools(server, { google: false })` in the web route.
- **Internal names are frozen.** The package scope `@liads/*`, the `~/.liads` dir, the
  `LIADS_*` env prefix, the `X-Liads-*` headers, and the change journal's `source: "liam"`
  value are intentionally NOT renamed to "adwarp" (renaming breaks stored creds, existing
  journals, and the deployed Vercel env). The brand "Adwarp" (formerly Liam) is
  visible-surface only, and the `liam` and `liads-mcp` bins stay as aliases. Google
  config shares `~/.liads` for the same reason, and because the change journal at its root
  already spans both platforms.
- Match the surrounding code style. Keep comments at the existing density. No em dashes in
  user-facing strings.

## LinkedIn API gotchas (learned from live testing — do not regress)

- **Versioned REST:** base `https://api.linkedin.com/rest`, headers `LinkedIn-Version`
  (pinned `202605` in config) + `X-Restli-Protocol-Version: 2.0.0`. Created-entity id comes
  back in the `x-restli-id` response header.
- **Account mapping:** development-tier apps must add each ad account in Developer Portal →
  Products → Advertising API → Account Management before they can create campaigns there.
- **Required campaign-group field:** `runSchedule` (even for drafts).
- **Required campaign fields:** `offsiteDeliveryEnabled` (bool) and `politicalIntent`
  (`NOT_POLITICAL` | `POLITICAL` | `NOT_DECLARED`). Both are auto-set.
- **Hierarchy:** Ad Account → Campaign Group → Campaign (targeting/budget/bid) → Creative.
- **Creatives** use the unified API (`content` + `intendedStatus`); single-image Sponsored
  Content is created inline via `?action=createInline`.
- **Audiences (DMP):** list-upload flow only — `generateUploadUrl` → upload hashed CSV to
  the signed URL → create `LIST_UPLOAD` segment → attach list → poll until READY for the
  `adSegment` urn. Emails are SHA256(lowercased, trimmed). `USER_LIST_UPLOAD` requires
  **300+ rows**; matching takes up to 48h. `uploadAudienceFromCsv` deletes the segment if
  the attach fails (no orphans).
- **CSV cleaning (`audienceCsv.ts`):** before upload, CSVs are normalized to LinkedIn's matched-
  audience format. Two types: contact (USER_LIST_UPLOAD, kept column `email`, SHA256-hashed) and
  company (COMPANY_LIST_UPLOAD, kept `companyname` + `companywebsite`). Header aliases map to
  canonical names; non-matcher columns are dropped; domains are converted to full `https://`
  website URLs (LinkedIn matches accounts on the website URL). Type auto-detects from columns.
- **Audience estimate:** use the `q=targetingCriteriaV2` finder with a restli-encoded
  `targetingCriteria` object (NOT the old dotted `target.includedTargetingFacets...`
  params, which now 400). The HTTP client has a `rawQuery` escape hatch for restli-encoded
  query strings (structure chars literal, URNs percent-encoded).
- **Targeting:** structured `TargetingSpec` = `{ include, exclude }` of short facet name →
  entity URNs. URNs within a facet are ORed; facets ANDed; excludes ORed. Resolve entity
  URNs with `searchTargeting` (typeahead) / `listFacetEntities`.
- **Conversions:** `associatedCampaigns` is READ-ONLY; the writable `campaigns` field is a
  **replace-whole-array** of campaign URNs (no `$add`). To attach a campaign you MUST read
  the conversion's current `campaigns`, append, and `$set` the full list — never drop
  existing associations. Update endpoint: `POST /conversions/{id}?account=<urn>` with
  `X-RestLi-Method: PARTIAL_UPDATE`.
- **Analytics:** use the `q=analytics` finder with `pivot=` (ACCOUNT|CAMPAIGN_GROUP|CAMPAIGN|
  CREATIVE), a `dateRange=(start:(year:..,month:..,day:..),end:(..))`, `timeGranularity`
  (ALL|DAILY|MONTHLY — no native WEEKLY, so bucket daily in code), and a filter
  `accounts|campaignGroups|campaigns|creatives=List(<encoded urns>)`. All restli-encoded, so it
  goes through the client's `rawQuery`. `costInUsd` is a string; metric field names are verified
  in `analytics.ts` DEFAULT_METRIC_FIELDS. Derived KPIs + flags live in `report.ts`.
- **Non-transactional orchestrator:** `launchFromBrief` creates a campaign group before the
  campaign; a later failure can orphan the group. (Cleanup-on-failure is implemented for
  audience upload; campaign-group cleanup is a known TODO.)

## Google Ads API gotchas (learned while building; do not regress)

- **Version is pinned** (`v25` in `google/config.ts`). Major versions carry breaking
  changes — v24 renamed `campaign.start_date` to `campaign.start_date_time` — and each is
  supported for roughly a year. Bump deliberately.
- **Three headers, every call:** `Authorization: Bearer`, `developer-token`, and
  `login-customer-id` **only** when reaching the account through a manager (MCC). Sending an
  unrelated login-customer-id is an authorization error, so it is opt-in via config. Customer
  ids go in without hyphens.
- **Developer token** comes from a **manager** account's API Center. A plain client account
  cannot issue one. Google usually auto-grants Explorer (2,880 production ops/day); Basic
  (15,000/day) is a separate application. Stan's token has Basic access as of 2026-09-13.
- **Explorer access blocks KeywordPlanService**, so `generateKeywordIdeas` needs **Basic**.
  Campaign creation, structure reads, and GAQL reporting all work on Explorer. If keyword
  ideas fail with an authorization error on an otherwise-working token, this is why.
- **OAuth needs `access_type=offline` AND `prompt=consent`.** Without both, Google returns a
  refresh token on the first authorization only, and every re-auth after that returns none.
- **Consent screen: anything but "Testing".** That status issues refresh tokens that die
  after 7 days. Beyond that it is a trade, not a rule: **Internal** (Workspace orgs) is what
  Google's OAuth docs recommend for a single-company tool and needs no verification;
  **External + In production** is required for brand verification (the pilot that cuts Basic
  Access review from days to hours), but `auth/adwords` is a **sensitive** scope, so a
  published external app can require full OAuth app verification. Internal is the better
  default here; Stan's project is Internal and works.
- **`googleAds:mutate` is the write path.** It takes operations across resource types, resolves
  **temporary resource names** (negative ids, e.g. `customers/X/campaigns/-2`), and is atomic.
  Temp ids must be unique across the whole request even between types, and a child may only
  reference a parent defined **earlier** in the list. This is why `launchSearchCampaign` builds
  budget → campaign → criteria → ad group → keywords → ads in that order.
- **`validateOnly: true` is a real server-side dry run.** Always send one before a real write.
  It must be marked `isRead` so it never reaches the change journal.
- **Errors nest three deep.** `error.details[].errors[]` is a `GoogleAdsFailure`; each entry has
  an `errorCode` object with exactly one key (the family), a message, and
  `location.fieldPathElements[]`. `flattenGoogleAdsErrors` unwraps this into one readable line
  with the field path. Without it every failure reads as an opaque 400.
- **int64 arrives as a string** in protobuf JSON. `metrics.impressions` and `metrics.cost_micros`
  are quoted; coerce before any arithmetic. Money is always micros (dollars × 1e6).
- **GAQL has no bound parameters.** Every interpolated value goes through `gaqlString`, or a name
  containing a quote breaks the query.
- **Reads are all GAQL**, via `searchStream`, which returns a JSON *array of chunks* and can carry
  an error inside a 200 response. The client checks the payload as well as the status.
- **Adding `segments.date` to a filter fans results out to one row per entity per day**, so
  `getGooglePerformance` merges rows back together before deriving KPIs.
- **Geo and language constants are queried, not hard-coded** (`geo_target_constant`,
  `language_constant` are queryable resources), so "US" and "en" never go stale.
- **The safety rule is structural.** No create schema can express a status other than `PAUSED`;
  only keyword criteria are `ENABLED`, since nothing serves under a paused parent. There is no
  activate tool, matching LinkedIn's draft-only rule. `packages/google/test/launch.test.mjs`
  asserts this against a stubbed transport — keep it passing.
- **Temp names only on referenced parents.** Composite-key resources (campaign criteria, ad
  group criteria, ad group ads, campaign shared sets) have ids like `parent~child`, and a negative
  temp id on them fails with `requestError.BAD_RESOURCE_ID`. `MutateBatch.add` appends them
  unnamed; `MutateBatch.create` (which hands out a temp name) is for budget, campaign, and ad
  groups only. The launch test asserts this split.
- **`path2` requires `path1`** on a responsive search ad, or Google returns
  `fieldError.VALUE_MUST_BE_UNSET`. The brief schema refuses `path2` alone.
- **Verified live with `validateOnly` on 2026-09-13** against a live Google Ads account:
  the full example brief passes Google's validators end to end. Both `startDateTime` formats,
  `"YYYY-MM-DD HH:MM:SS"` (documented) and `"YYYYMMDD HH:MM:SS"` (Google's samples), were
  accepted by the dry run, so Adwarp passes the field through as given. A real `--apply` has not
  been run yet; the first real launch is the live test of the result parsing in
  `createdResourceNames` and the `~`-split ad ids.

## Build / verify

```bash
pnpm install
pnpm -r build        # shared builds first; core/google before cli/mcp/web resolve their dist
pnpm -r typecheck
pnpm test            # node --test over packages/google/test
```

The hosted app auto-deploys on push to `main` (Vercel GitHub integration). Verify a live
change by initializing the MCP endpoint and listing tools (see README).

## Salesforce

`core/src/salesforce.ts` shells out to the authenticated `sf` CLI (`sf data query --json`).
No new credentials; reuses the user's existing `sf` login. Read-only. `audienceFromSalesforce`
turns a SOQL email query into a matched-audience DMP segment (reuses `uploadAudienceFromEmails`).
