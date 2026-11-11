/**
 * Keeps the Ad Library app clear of LinkedIn's daily limits: every call paced, counted and sent once; a 429 waited
 * out at most once and only with a short Retry-After; 401 and 403 stop at once; a spent budget stops before calling.
 * Runs against dist with a fake client, a fake clock and a temp state folder. No network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const core = await import("../dist/index.js");
const { searchAdLibraryApi, AdLibraryGuard, DailyCallBudget, AdLibraryThrottledError, AdLibraryAccessError, AdLibraryBudgetError, LinkedInApiError } = core;

const element = (id, companyId = "1406226") => ({
  adUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
  details: { type: "SPONSORED_STATUS_UPDATE", advertiser: { advertiserName: "Ramp", advertiserUrl: `https://www.linkedin.com/company/${companyId}` } },
});
const page = (from, n) => ({ data: { elements: Array.from({ length: n }, (_, i) => element(String(from + i))), paging: { total: 999 } } });
const apiError = (status, retryAfter, message = `LinkedIn API ${status}`) => new LinkedInApiError(message, status, {}, undefined, retryAfter);

/** A client that answers each call with the next scripted answer (a response, or an error to throw). */
function scriptedClient(answers) {
  const calls = [];
  return {
    calls,
    request: async (opts) => {
      calls.push(opts);
      const next = answers[calls.length - 1];
      if (next === undefined) throw new Error("unexpected extra call");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

/** A guard on a fake clock: sleeping moves the clock, nothing really waits. */
function fakeGuard(extra = {}) {
  const clock = { t: 1_800_000_000_000 };
  const slept = [];
  const guard = new AdLibraryGuard({
    pacer: { last: 0 },
    now: () => clock.t,
    sleep: async (ms) => {
      slept.push(ms);
      clock.t += ms;
    },
    random: () => 0,
    ...extra,
  });
  return { guard, slept, clock };
}

test("every call is sent once (no HTTP retries) and at least 2.2s after the last", async () => {
  const client = scriptedClient([page(1, 25), page(26, 25), page(51, 10)]);
  const { guard, slept } = fakeGuard();
  const res = await searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard });
  assert.equal(res.ads.length, 60);
  assert.equal(client.calls.length, 3);
  assert.ok(client.calls.every((c) => c.noRetry === true));
  assert.deepEqual(slept, [2200, 2200]);
  assert.equal(guard.calls, 3);
});

test("pacing can't go under 2.2s, and jitter only adds to it", async () => {
  assert.equal(new AdLibraryGuard({ minIntervalMs: 500 }).minIntervalMs, 2200);
  const client = scriptedClient([page(1, 25), page(26, 5)]);
  const { guard, slept } = fakeGuard({ random: () => 0.5, jitterMs: 600 });
  await searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard });
  assert.deepEqual(slept, [2500]);
});

test("pacing spans searches: the next advertiser's first call waits for the last one's", async () => {
  const client = scriptedClient([page(1, 5), page(100, 5)]);
  const { guard, slept } = fakeGuard();
  await searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard });
  await searchAdLibraryApi(client, { advertiser: "Rippling", max: 100, guard });
  assert.deepEqual(slept, [2200]);
});

test("a 429 with a short Retry-After is waited out once; a second 429 stops and keeps what was read", async () => {
  const client = scriptedClient([page(1, 25), apiError(429, "5"), apiError(429, "5")]);
  const { guard, slept } = fakeGuard();
  await assert.rejects(searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard }), (err) => {
    assert.ok(err instanceof AdLibraryThrottledError);
    assert.equal(err.reason, "throttled");
    assert.equal(err.partial.ads.length, 25, "the first page is kept");
    assert.match(err.message, /daily Ad Library quota is likely spent until midnight UTC/);
    assert.match(err.message, /Stopped, keeping the 25 ads collected so far/);
    return true;
  });
  assert.equal(client.calls.length, 3, "1 page, the throttled call, 1 retry after Retry-After, nothing more");
  assert.ok(slept.includes(5000));
});

test("a 429 without Retry-After, or with a long one, stops at once", async () => {
  for (const retryAfter of [undefined, "3600"]) {
    const client = scriptedClient([apiError(429, retryAfter)]);
    const { guard } = fakeGuard();
    await assert.rejects(searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard }), AdLibraryThrottledError);
    assert.equal(client.calls.length, 1);
  }
});

test("a run waits out a 429 once in all, not once per page", async () => {
  const client = scriptedClient([apiError(429, "1"), page(1, 25), apiError(429, "1")]);
  const { guard } = fakeGuard();
  await assert.rejects(searchAdLibraryApi(client, { advertiser: "Ramp", max: 100, guard }), AdLibraryThrottledError);
  assert.equal(client.calls.length, 3);
});

test("403 and 401 stop at once and say why", async () => {
  const forbidden = scriptedClient([apiError(403)]);
  await assert.rejects(searchAdLibraryApi(forbidden, { advertiser: "Ramp", guard: fakeGuard().guard }), (err) => {
    assert.ok(err instanceof AdLibraryAccessError);
    assert.equal(err.reason, "access");
    assert.match(err.message, /isn't approved for the LinkedIn Ad Library product .* or its access was revoked\. Stopped without retrying/);
    return true;
  });
  assert.equal(forbidden.calls.length, 1);
  const unauthorized = scriptedClient([apiError(401)]);
  await assert.rejects(searchAdLibraryApi(unauthorized, { advertiser: "Ramp", guard: fakeGuard().guard }), /401 .* invalid, expired or revoked/);
  assert.equal(unauthorized.calls.length, 1);
});

test("a server error is retried once, then reported as an error, not a stop", async () => {
  const client = scriptedClient([apiError(500), apiError(502)]);
  await assert.rejects(searchAdLibraryApi(client, { advertiser: "Ramp", guard: fakeGuard().guard }), (err) => !(err instanceof core.AdLibraryStopError) && err.status === 502);
  assert.equal(client.calls.length, 2);
});

test("stopAfterPage ends paging after a page with nothing new", async () => {
  const client = scriptedClient([page(1, 25), page(26, 25)]);
  const known = new Set(Array.from({ length: 50 }, (_, i) => String(1 + i)));
  const res = await searchAdLibraryApi(client, { advertiser: "Ramp", max: 500, guard: fakeGuard().guard, stopAfterPage: (p) => p.every((a) => known.has(a.detailId)) });
  assert.equal(client.calls.length, 1);
  assert.equal(res.ads.length, 25);
});

test("the daily budget counts every call across runs, refuses before calling, and stores no ID or token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "adwarp-budget-"));
  try {
    const now = () => new Date("2026-11-11T15:00:00Z");
    const budget = () => new DailyCallBudget({ limit: 2, clientId: "86abcdefclient", dir, now });

    const first = scriptedClient([page(1, 25), page(26, 25)]);
    await assert.rejects(searchAdLibraryApi(first, { advertiser: "Ramp", max: 100, guard: fakeGuard({ budget: budget() }).guard }), (err) => {
      assert.ok(err instanceof AdLibraryBudgetError);
      assert.equal(err.partial.ads.length, 50);
      assert.match(err.message, /daily budget of 2 Ad Library calls for this app is used \(2 today, UTC\), so the call wasn't sent\. 0 calls left; it resets at midnight UTC, in 9h 0m/);
      return true;
    });
    assert.equal(first.calls.length, 2);

    // A second run, as from another process: the count is on disk, so nothing goes out.
    const second = scriptedClient([page(1, 25)]);
    await assert.rejects(searchAdLibraryApi(second, { advertiser: "Ramp", guard: fakeGuard({ budget: budget() }).guard }), AdLibraryBudgetError);
    assert.equal(second.calls.length, 0);
    assert.equal(await budget().remaining(), 0);

    // Another app has its own count; tomorrow starts fresh.
    assert.equal(await new DailyCallBudget({ limit: 2, clientId: "another-app", dir, now }).remaining(), 2);
    assert.equal(await new DailyCallBudget({ limit: 2, clientId: "86abcdefclient", dir, now: () => new Date("2026-11-12T00:00:01Z") }).remaining(), 2);

    const files = await readdir(dir);
    assert.ok(files.every((f) => /^[0-9a-f]{16}-\d{4}-\d{2}-\d{2}\.calls$/.test(f)), "file names hold a hash and a date only");
    assert.ok(!files.some((f) => f.includes("86abcdefclient")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the HTTP layer sends 1 request with noRetry, and the error carries Retry-After", async () => {
  const realFetch = globalThis.fetch;
  let sent = 0;
  globalThis.fetch = async () => {
    sent++;
    return new Response(JSON.stringify({ message: "Resource level throttle limit for calls to this resource is reached" }), { status: 429, headers: { "retry-after": "30" } });
  };
  try {
    const client = new core.LinkedInClient({ clientId: "x", clientSecret: "y" }, async () => "token");
    await assert.rejects(client.request({ path: "/adLibrary", query: { q: "criteria" }, noRetry: true }), (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, "30");
      return true;
    });
    assert.equal(sent, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Retry-After in seconds or as a date, and the time to midnight UTC", () => {
  const now = new Date("2026-11-11T23:30:00Z");
  assert.equal(core.retryAfterSeconds("12", now), 12);
  assert.equal(core.retryAfterSeconds("Wed, 11 Nov 2026 23:31:00 GMT", now), 60);
  assert.equal(core.retryAfterSeconds(undefined, now), undefined);
  assert.equal(core.untilMidnightUtc(now), "0h 30m");
});
