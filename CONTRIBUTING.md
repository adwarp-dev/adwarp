# Contributing

Thanks for your interest. This is a pnpm + TypeScript monorepo.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
```

## Layout

- `packages/core`: LinkedIn REST client, OAuth, resource modules, audience hashing, Salesforce and HubSpot readers.
- `packages/mcp`: MCP server. `src/tools.ts` registers tools; `src/index.ts` is the stdio entry.
- `packages/cli`: the `adwarp` CLI (also installed as `liam`, the legacy alias).
- `packages/adwarp`: the npm package `adwarp`, which bundles the CLI and the MCP server. Test
  a change the way users get it with `pnpm pack` in that folder, then
  `node scripts/smoke.mjs <tarball>`.
- `apps/web`: Next.js app hosting the MCP over HTTP (Vercel). It has no pages: its old paths
  redirect to adwarp.dev, which renders the docs from `docs/` on `main`.

## Conventions

- Every campaign/creative is created `DRAFT`. Do not change that default.
- All LinkedIn payload shapes live as zod schemas in `packages/core/src/schemas.ts` and are
  reused as MCP tool inputs. Add new fields there first.
- Secrets never enter the repo. Local credentials live in `~/.adwarp` (or `~/.liads` on older installs); hosted in env vars.

## Pull requests

Run `pnpm -r typecheck` before opening a PR. Keep changes focused and describe the LinkedIn
API behavior you relied on (link the versioned docs).

## Releasing

1. Set the version with `pnpm set-version 0.3.0`. It updates `packages/adwarp/package.json`,
   `packages/shared/src/version.ts` and both versions in `server.json`, and the build fails
   when they disagree. Optionally add `.github/release-notes/v0.3.0.md`, a short summary that
   goes above the generated list of merged pull requests.
2. Open a PR and merge it.
3. Tag the merge commit on main and push the tag: `git tag v0.3.0 && git push origin v0.3.0`.

The Release workflow (`.github/workflows/release.yml`) then checks that the tag is on main and
matches the version, builds and smoke-tests the package, and:

- publishes `adwarp` to npm, with provenance
- creates the GitHub release with the package tarball attached
- publishes `server.json` to the official MCP Registry as `io.github.adwarp-dev/adwarp`
- calls the website's deploy hook so adwarp.dev picks up the new docs and changelog

Each step skips work that is already done, so a failed run can be re-run as is.

One-time setup for maintainers:

- npm: on the `adwarp` package settings page, add a trusted publisher for GitHub Actions
  (organization `adwarp-dev`, repository `adwarp`, workflow `release.yml`). Until then, an
  `NPM_TOKEN` repository secret with publish rights works as a fallback.
- `WEBSITE_DEPLOY_HOOK` repository secret: the Vercel deploy hook URL for the website project.
  Without it the workflow skips the rebuild with a warning.

## Glama release

Glama lists Adwarp at <https://glama.ai/mcp/servers/adwarp-dev/adwarp>. `glama.json` at the
repo root names its maintainers, and that is the only field Glama reads from it. A Glama
release is a container image Glama builds, scans and lets people deploy. It is separate from
the npm and GitHub releases above, and nothing in this repo or the Release workflow creates
one.

Glama does not build the root `Dockerfile`. It generates its own from the settings on
<https://glama.ai/mcp/servers/adwarp-dev/adwarp/admin/dockerfile>: it clones the repo into
`/app`, runs the build steps there, and starts the CMD wrapped in `mcp-proxy`. The settings
below build the same npm package as the root `Dockerfile` and install it globally, so Glama
runs what `npx adwarp` installs, not the source checkout.

**Node.js version:** `22`, the same as the root `Dockerfile`.

**Build steps:**

```json
[
  "pnpm install --frozen-lockfile --filter \"adwarp...\"",
  "pnpm --filter \"adwarp...\" build",
  "cd packages/adwarp && pnpm pack && npm install -g --no-audit --no-fund ./adwarp-*.tgz"
]
```

Each step starts in `/app`, so the last one changes into `packages/adwarp` itself. The
"Failed to create bin" warnings pnpm prints during install are expected: those bins point at
`dist` files that the build step creates.

**CMD arguments:**

```json
["adwarp-mcp"]
```

Glama adds `mcp-proxy` in front, so the CMD names only the server.

**Placeholder parameters:**

```json
{}
```

The server starts and lists its tools without credentials, so the build test needs none.

**Environment variables JSON schema:**

```json
{
  "type": "object",
  "properties": {
    "ADWARP_LINKEDIN_CLIENT_ID": {
      "type": "string",
      "description": "LinkedIn app Client ID. The LinkedIn tools need it with the client secret and refresh token."
    },
    "ADWARP_LINKEDIN_CLIENT_SECRET": {
      "type": "string",
      "description": "LinkedIn app Client Secret."
    },
    "ADWARP_LINKEDIN_REFRESH_TOKEN": {
      "type": "string",
      "description": "LinkedIn refresh token. Run adwarp auth login, then adwarp auth export to print it."
    },
    "ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID": {
      "type": "string",
      "description": "LinkedIn ad account used when a call omits one."
    },
    "ADWARP_LINKEDIN_VERSION": {
      "type": "string",
      "description": "LinkedIn API version pin (YYYYMM). Leave unset for the built-in version."
    },
    "ADWARP_GOOGLE_CLIENT_ID": {
      "type": "string",
      "description": "Google OAuth client ID. The Google Ads tools need it with the client secret and refresh token."
    },
    "ADWARP_GOOGLE_CLIENT_SECRET": {
      "type": "string",
      "description": "Google OAuth client secret."
    },
    "ADWARP_GOOGLE_REFRESH_TOKEN": {
      "type": "string",
      "description": "Google refresh token from adwarp google auth login."
    },
    "ADWARP_GOOGLE_LOGIN_CUSTOMER_ID": {
      "type": "string",
      "description": "Manager account ID, only when you reach the ad account through a manager."
    },
    "ADWARP_GOOGLE_DEFAULT_CUSTOMER_ID": {
      "type": "string",
      "description": "Google Ads account used when a call omits one."
    },
    "ADWARP_GOOGLE_API_VERSION": {
      "type": "string",
      "description": "Google Ads API version pin, for example v25. Leave unset for the built-in version."
    },
    "ADWARP_HUBSPOT_TOKEN": {
      "type": "string",
      "description": "HubSpot private app token for audience_from_hubspot."
    },
    "ADWARP_CREATIVE_WORKER_URL": {
      "type": "string",
      "description": "HTTPS URL of the optional remote creative worker for competitor ad copy. Set with its token."
    },
    "ADWARP_CREATIVE_WORKER_TOKEN": {
      "type": "string",
      "description": "Bearer token for the remote creative worker."
    }
  },
  "required": []
}
```

Nothing is required, and the schema has no `oneOf`, so any combination validates. A tool
called without the credentials it needs returns an error naming them, and blank values count
as unset. The `LIADS_*` and `GADS_*` names from before the rename still work and the schema
does not reject them, but it lists only the current names. `MCP_AUTH_TOKEN` belongs to the
hosted endpoint in `apps/web` and does nothing here.

To publish a release:

1. Merge what the release should contain to `main`. A commit with a `v*` tag keeps Glama, npm
   and GitHub on the same code and version.
2. In Glama's admin, sync the listing to that commit and apply the settings above.
3. Click **Build**. The build test builds the image and starts the server. Check the test
   once it passes.
4. Create a release from the passing build (**Make Release** in the test list, or **Create
   Release** on the test page), enter the version from `packages/adwarp/package.json`, and
   publish it. **Build & Release** runs steps 3 and 4 together and picks the version itself.

A new release replaces the previous one. Glama then runs its own checks on the image, and
how those turn out is a separate result.
