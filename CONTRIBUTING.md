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
- `apps/web`: Next.js app hosting the MCP over HTTP (Vercel).

## Conventions

- Every campaign/creative is created `DRAFT`. Do not change that default.
- All LinkedIn payload shapes live as zod schemas in `packages/core/src/schemas.ts` and are
  reused as MCP tool inputs. Add new fields there first.
- Secrets never enter the repo. Local credentials live in `~/.liads`; hosted in env vars.

## Pull requests

Run `pnpm -r typecheck` before opening a PR. Keep changes focused and describe the LinkedIn
API behavior you relied on (link the versioned docs).
