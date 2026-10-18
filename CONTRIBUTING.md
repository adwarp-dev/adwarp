# Contributing

Thanks for your interest. This is a pnpm + TypeScript monorepo.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
```

## Layout

- `packages/core`: LinkedIn REST client, OAuth, resource modules, audience hashing, Salesforce reader.
- `packages/mcp`: MCP server. `src/tools.ts` registers tools; `src/index.ts` is the stdio entry.
- `packages/cli`: the `adwarp` CLI (also installed as `liam`, the legacy alias).
- `packages/adwarp`: the npm package `adwarp`, which bundles the CLI and the MCP server. Test
  a change the way users get it with `pnpm pack` in that folder, then
  `node scripts/smoke.mjs <tarball>`.
- `apps/web`: Next.js app hosting the MCP over HTTP (Vercel).

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
