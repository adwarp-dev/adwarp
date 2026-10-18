# Remote creative worker

Adwarp's CLI and MCP use the official API for discovery. Only this separate Linux service
can open creative pages. It must run on a cloud host with its own outbound IP, not on the
user's Mac, home network, or a tunnel through either. No personal LinkedIn cookies,
credentials, proxies or IP rotation are used. A cloud IP can still be blocked; the worker
stops rather than trying to bypass it.

This adds a cache that Adwarp did not previously have. It stores extracted copy, a preview
screenshot and collection time in a persistent SQLite database and volume. Cached results
are reused for seven days, then refreshed on the next request; this is a freshness window,
not automatic deletion of stored results.
Original video files/transcripts and every carousel slide are not collected. Screenshots
capture the rendered preview; image URLs exclude company logos/profile pictures. Selectors
can change, so inspect initial results before relying on extraction quality.

## Deploy on a dedicated Linux host

Requires Docker Engine with Compose and support for Chromium's sandbox/user namespaces.
The included seccomp profile is from Microsoft's Playwright project:
https://raw.githubusercontent.com/microsoft/playwright/main/utils/docker/seccomp_profile.json
It permits the namespace operations Chromium's sandbox needs. The container runs as the
non-root `node` user with Chromium sandboxing enabled. Do not disable the sandbox to fix
host configuration problems.

1. Check out this branch on the cloud host. From the repository root, create an ignored
   `services/creative-worker/.env` file with a randomly generated token of at least 32
   characters: `LIADS_CREATIVE_WORKER_TOKEN=...`. Restrict its permissions to 0600.
2. Build and start exactly one instance:

   ```sh
   docker compose --env-file services/creative-worker/.env -f services/creative-worker/compose.yaml up -d --build
   ```

3. Put an HTTPS reverse proxy on that host in front of `127.0.0.1:8080`. Keep port 8080
   inaccessible from the public network. Use a dedicated hostname and a valid TLS certificate.
   Every endpoint, including screenshots, requires the bearer token. Do not log authorization
   headers. Do not expose the service until HTTPS and authentication have been checked.
4. Configure the CLI shell and/or hosted MCP deployment:

   ```sh
   export LIADS_CREATIVE_WORKER_URL=https://your-worker-hostname
   export LIADS_CREATIVE_WORKER_TOKEN=...  # same secret, supplied through secret storage
   ```

5. Perform read-only status/authentication checks first. A GET for an unknown ad ID must
   return `missing` without visiting LinkedIn. A request without a token must return 401.
   Then, only when collection is authorized, submit one verified ad and inspect its result.

The SQLite database, screenshots, budgets and block state live on the `creative-data`
named volume. Preserve and back up the volume. Do not deploy replicas with separate volumes,
remove the volume to recover from a block, or let multiple services share the same egress IP
without a shared queue. The service deliberately does not restart automatically.

## Use

```sh
adwarp competitor ads Ramp --company-id 1406226 --max 100 --copy-max 10 --json
adwarp creative-status 1473633543,1473650383
```

Use advertiser name plus numeric companyId. The API does not filter by ID, so Adwarp filters
its metadata results before collecting creatives. The first metadata page may contain no
matching ads; increase metadata `max` within its 500 limit if necessary. A numeric ID alone
no longer silently launches a browser. API errors never fall back to the browser.

`auto` returns cached results and pending job IDs immediately. The MCP equivalent status
tool is `get_competitor_creatives`. Read status instead of repeating discovery. No worker
configuration means metadata only. `engine=api` never contacts the creative worker.

## API

All endpoints require `Authorization: Bearer <worker token>`; no query-string tokens.

- `POST /v1/creatives` with `{"ids":["1473633543"]}`: enqueue missing/stale IDs and return
  status. Only 1-10 numeric IDs are accepted. No URLs, cookies, credentials, force-refresh,
  concurrency or budget overrides are accepted.
- `GET /v1/creatives?ids=1473633543`: read results without queuing anything.
- `GET /v1/creatives/1473633543/screenshot`: retrieve a completed preview PNG.

Responses contain `blocked`, `note`, and `creatives` with `id`, `status`, optional `copy`,
`collectedAt` and `error`. Status is `missing`, `pending`, `running`, `done` or `failed`.
A pending job may wait for budget availability. Copy includes an authenticated relative
`screenshotPath`. Never embed the bearer token into that path or an output artifact.

## Enforced limits and recovery

One process owns the durable store and one browser runs at a time. Repeated IDs share jobs.
Limits are centralized in `store.mjs`: 10 IDs per submission, 100 pending/running jobs,
50 page attempts and 500 allowed outgoing browser requests per rolling 24 hours, and at
least 15 seconds between page starts. These are conservative defaults, not guaranteed safe
LinkedIn rates. Subresources count, so actual daily creative capacity may be much lower.
Search pagination is not implemented on the worker: discovery must use the official API.

Responses of 403/429/503, recognizable challenge pages (including HTTP 200), or the browser's
HTTP response failure stop collection. The block persists; subsequent requests can read
cached results but cannot queue or run more scraping. Other failed ads are not automatically
retried and have a 24-hour negative cache. Request and page attempts are recorded before
network work so crashes cannot refund the budget.

A graceful stop drains the current job and releases the database owner lock. An unclean
exit leaves the lock in place. An operator must stop **all** worker containers before
recovery. `recover` clears a stale process lock and marks interrupted jobs failed; it
preserves the block. `resume` additionally clears the block only after explicit review:

```sh
docker compose --env-file services/creative-worker/.env -f services/creative-worker/compose.yaml stop
docker compose --env-file services/creative-worker/.env -f services/creative-worker/compose.yaml run --rm --no-deps creative-worker node services/creative-worker/operator.mjs recover --all-workers-stopped
# Use resume instead of recover only after explicitly authorizing collection to resume.
docker compose --env-file services/creative-worker/.env -f services/creative-worker/compose.yaml up -d
```

There is no remote reset endpoint. Recovery preserves rolling budgets. HTTP status reads
remain available when collection is blocked. Do not switch networks or rotate proxies to
continue after a block.

## Offline verification

Node 22.13+ is required by the worker's built-in SQLite module. From the repo root:

```sh
pnpm --filter @liads/core build
node --test services/creative-worker/test/*.test.mjs
```

Tests use temporary/in-memory databases, mocked collection and a localhost HTTP server.
They make no LinkedIn requests and launch no browsers. Container building and a remote
single-ad smoke test are separate deployment checks, not part of the unit suite.
