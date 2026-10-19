/**
 * HubSpot audiences: reading a CRM search or a list's members, cleaning them like a
 * CSV, and uploading only email hashes for contacts.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first). HubSpot answers from a
 * stubbed fetch and LinkedIn from a fake client, so no credentials are needed and
 * nothing outside this process is called. HOME points at an empty folder, so the
 * token file is the test's own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "adwarp-hubspot-"));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
delete process.env.ADWARP_HUBSPOT_TOKEN;
process.on("exit", () => rmSync(HOME, { recursive: true, force: true }));

const {
  previewHubSpotAudience,
  audienceFromHubSpot,
  parseHubSpotFilter,
  toHubSpotSearchFilter,
  hubspotConfigPath,
} = await import("../dist/index.js");

const API = "https://api.hubapi.com";
const UPLOAD_URL = "https://upload.linkedin.test/list";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Replaces fetch for a single test. `handler` answers each call; every call is recorded.
 * Anything it does not answer fails the test, so no request can reach a real host.
 */
function stubFetch(t, handler) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body,
    };
    calls.push(call);
    const res = await handler(call);
    if (!res) throw new Error(`Unexpected request: ${call.method} ${url}`);
    return res;
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return calls;
}

/** Sets the token env var for a single test, or leaves it unset with `undefined`. */
function withTokenEnv(t, value) {
  if (value === undefined) delete process.env.ADWARP_HUBSPOT_TOKEN;
  else process.env.ADWARP_HUBSPOT_TOKEN = value;
  t.after(() => delete process.env.ADWARP_HUBSPOT_TOKEN);
}

/** Writes hubspot.json in the test's Adwarp folder for a single test. */
function withTokenFile(t, contents) {
  mkdirSync(join(HOME, ".adwarp"), { recursive: true });
  writeFileSync(hubspotConfigPath, contents, { mode: 0o600 });
  t.after(() => rmSync(hubspotConfigPath, { force: true }));
}

/** A LinkedIn client that records calls and answers the matched-audience upload flow. */
function fakeLinkedIn() {
  const calls = [];
  const client = {
    calls,
    request: async (req) => {
      calls.push(req);
      if (req.query?.action === "generateUploadUrl") return { data: { value: UPLOAD_URL }, status: 200 };
      if (req.path === "/dmpSegments" && req.method === "POST") return { data: undefined, status: 201, restliId: "9001" };
      if (req.path === "/dmpSegments/9001/listUploads") return { data: undefined, status: 201 };
      throw new Error(`Unexpected LinkedIn call: ${req.method} ${req.path}`);
    },
  };
  return { client, getToken: async () => "li-token" };
}

const CUSTOMERS = [{ property: "lifecyclestage", operator: "EQ", value: "customer" }];

test("a missing token names the env var, the file and the scopes, and calls nothing", async (t) => {
  withTokenEnv(t, undefined);
  const calls = stubFetch(t, () => undefined);
  const li = fakeLinkedIn();

  const expected = (err) => {
    assert.match(err.message, /ADWARP_HUBSPOT_TOKEN/);
    assert.match(err.message, /hubspot\.json/);
    assert.match(err.message, /crm\.objects\.contacts\.read, crm\.objects\.companies\.read and crm\.lists\.read/);
    return true;
  };
  await assert.rejects(previewHubSpotAudience({ name: "Customers", filters: CUSTOMERS }), expected);
  await assert.rejects(
    audienceFromHubSpot(li.client, li.getToken, { accountId: "1", name: "Customers", filters: CUSTOMERS }),
    expected,
  );
  assert.equal(calls.length, 0);
  assert.equal(li.client.calls.length, 0);
});

test("search reads every page with the filters ANDed, and the dry run uploads nothing", async (t) => {
  withTokenEnv(t, undefined);
  withTokenFile(t, JSON.stringify({ accessToken: "pat-file" }));
  const pages = {
    undefined: { total: 5, results: [{ id: "1", properties: { email: " Ada@Example.com" } }, { id: "2", properties: { email: null } }], paging: { next: { after: "2" } } },
    2: { total: 5, results: [{ id: "3", properties: { email: "not-an-email" } }, { id: "4", properties: { email: "ada@example.com" } }], paging: { next: { after: "4" } } },
    4: { total: 5, results: [{ id: "5", properties: { email: "bob@example.org" } }] },
  };
  const calls = stubFetch(t, (c) =>
    c.url.href === `${API}/crm/objects/2026-09/contacts/search` && c.method === "POST" ? json(pages[c.body.after]) : undefined,
  );

  const filters = [...CUSTOMERS, { property: "hs_lead_status", operator: "IN", value: "NEW, OPEN" }];
  const preview = await previewHubSpotAudience({ name: "Customers", filters });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((c) => c.body.after), [undefined, "2", "4"]);
  for (const c of calls) {
    assert.equal(c.headers.Authorization, "Bearer pat-file");
    assert.deepEqual(c.body.filterGroups, [
      {
        filters: [
          { propertyName: "lifecyclestage", operator: "EQ", value: "customer" },
          { propertyName: "hs_lead_status", operator: "IN", values: ["NEW", "OPEN"] },
        ],
      },
    ]);
    assert.deepEqual(c.body.properties, ["email"]);
    assert.equal(c.body.limit, 200);
  }

  assert.equal(preview.dryRun, true);
  assert.equal(preview.audienceType, "contact");
  assert.deepEqual(preview.source, { kind: "search", filters });
  assert.equal(preview.read, 5);
  assert.equal(preview.valid, 2);
  assert.equal(preview.uploaded, 0);
  assert.equal(preview.skipped, 3);
  assert.deepEqual(preview.skippedReasons, { "no email": 1, "invalid email": 1, "duplicate email": 1 });
  assert.deepEqual(preview.columns, ["email", "sha256"]);
  assert.deepEqual(preview.sample, [
    { email: "ad***@example.com", sha256: sha256("ada@example.com") },
    { email: "bo***@example.org", sha256: sha256("bob@example.org") },
  ]);
  assert.ok(!JSON.stringify(preview).includes("ada@example.com"), "the sample never carries a raw email");
  assert.ok(preview.warnings.some((w) => /Only 2 valid emails/.test(w)));
});

test("a search over HubSpot's 10,000 result cap stops after the first page", async (t) => {
  withTokenEnv(t, "pat-env");
  const calls = stubFetch(t, () => json({ total: 10_001, results: [], paging: { next: { after: "200" } } }));
  await assert.rejects(previewHubSpotAudience({ name: "Everyone", filters: CUSTOMERS }), /10001 contacts.*at most 10000/);
  assert.equal(calls.length, 1);
});

test("a list reads every membership page, batch reads in 100s, and uploads only email hashes", async (t) => {
  withTokenEnv(t, "pat-env");
  const ids = Array.from({ length: 150 }, (_, i) => String(i + 1));
  const upload = [];
  const calls = stubFetch(t, (c) => {
    const path = c.url.pathname;
    if (path === "/crm/lists/2026-09/77") {
      return json({ list: { listId: "77", name: "Target accounts", objectTypeId: "0-1", processingType: "DYNAMIC" } });
    }
    if (path === "/crm/lists/2026-09/77/memberships") {
      return c.url.searchParams.get("after") === "p2"
        ? json({ results: ids.slice(100).map((recordId) => ({ recordId })) })
        : json({ results: ids.slice(0, 100).map((recordId) => ({ recordId })), paging: { next: { after: "p2" } } });
    }
    if (path === "/crm/objects/2026-09/contacts/batch/read" && c.method === "POST") {
      // Record 150 was deleted after it joined the list: HubSpot answers 207 without it.
      const found = c.body.inputs.filter(({ id }) => id !== "150");
      const body = { status: "COMPLETE", results: found.map(({ id }) => ({ id, properties: { email: `User${id}@Example.com` } })) };
      return json(body, found.length < c.body.inputs.length ? 207 : 200);
    }
    if (c.url.href === UPLOAD_URL && c.method === "POST") {
      upload.push(c);
      return new Response(null, { status: 201, headers: { location: "D4E10AQ" } });
    }
    return undefined;
  });
  const li = fakeLinkedIn();

  const res = await audienceFromHubSpot(li.client, li.getToken, { accountId: "123", name: "Target accounts", listId: "77" });

  const hubspot = calls.filter((c) => c.url.origin === API);
  assert.deepEqual(
    hubspot.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`),
    [
      "GET /crm/lists/2026-09/77",
      "GET /crm/lists/2026-09/77/memberships?limit=100",
      "GET /crm/lists/2026-09/77/memberships?limit=100&after=p2",
      "POST /crm/objects/2026-09/contacts/batch/read",
      "POST /crm/objects/2026-09/contacts/batch/read",
    ],
  );
  const reads = hubspot.filter((c) => c.method === "POST");
  assert.deepEqual(reads.map((c) => c.body.inputs.length), [100, 50]);
  assert.deepEqual(reads[0].body.properties, ["email"]);
  assert.ok(hubspot.every((c) => c.headers.Authorization === "Bearer pat-env"));

  assert.equal(res.dryRun, false);
  assert.equal(res.segmentId, "9001");
  assert.equal(res.status, "PROCESSING");
  assert.equal(res.audienceType, "contact");
  assert.deepEqual(res.source, { kind: "list", listId: "77", listName: "Target accounts", processingType: "DYNAMIC" });
  assert.equal(res.read, 150);
  assert.equal(res.valid, 149);
  assert.equal(res.uploaded, 149);
  assert.deepEqual(res.skippedReasons, { "not found in HubSpot": 1 });

  // Only the hashed CSV leaves for LinkedIn: no raw email anywhere in what was sent.
  assert.equal(upload.length, 1);
  const [header, ...rows] = upload[0].body.trim().split("\n");
  assert.equal(header, "email");
  assert.equal(rows.length, 149);
  assert.ok(rows.every((r) => /^[0-9a-f]{64}$/.test(r)));
  assert.ok(rows.includes(sha256("user1@example.com")));
  assert.ok(!JSON.stringify(li.client.calls).includes("@"));
  const segment = li.client.calls.find((c) => c.path === "/dmpSegments" && c.body?.name);
  assert.equal(segment.body.type, "USER_LIST_UPLOAD");
  assert.equal(segment.body.name, "Target accounts");
});

test("a company list sets the type, turns domains into websites, and refuses a contact type", async (t) => {
  withTokenEnv(t, "pat-env");
  const companies = {
    1: { name: "Acme", domain: "acme.com" },
    2: { name: "", domain: null },
    3: { name: "Globex", domain: "www.globex.io" },
  };
  const calls = stubFetch(t, (c) => {
    const path = c.url.pathname;
    if (path === "/crm/lists/2026-09/12") return json({ list: { listId: "12", name: "ABM", objectTypeId: "0-2", processingType: "MANUAL" } });
    if (path === "/crm/lists/2026-09/12/memberships") return json({ results: [{ recordId: "1" }, { recordId: "2" }, { recordId: "3" }] });
    if (path === "/crm/objects/2026-09/companies/batch/read") {
      return json({ results: c.body.inputs.map(({ id }) => ({ id, properties: companies[id] })) });
    }
    return undefined;
  });

  const preview = await previewHubSpotAudience({ name: "ABM", listId: "12" });
  assert.equal(preview.audienceType, "company");
  assert.equal(preview.read, 3);
  assert.equal(preview.valid, 2);
  assert.deepEqual(preview.skippedReasons, { "no name or domain": 1 });
  assert.deepEqual(preview.columns, ["companyname", "companywebsite"]);
  assert.deepEqual(preview.sample, [
    { companyname: "Acme", companywebsite: "https://acme.com" },
    { companyname: "Globex", companywebsite: "https://globex.io" },
  ]);
  assert.deepEqual(calls.find((c) => c.method === "POST").body.properties, ["name", "domain"]);

  await assert.rejects(previewHubSpotAudience({ name: "ABM", listId: "12", type: "contact" }), /company list, but type is contact/);
});

test("an empty result: the dry run reports zeros and the upload stops before LinkedIn", async (t) => {
  withTokenEnv(t, "pat-env");
  stubFetch(t, (c) => (c.url.pathname === "/crm/objects/2026-09/contacts/search" ? json({ total: 0, results: [] }) : undefined));
  const li = fakeLinkedIn();

  const preview = await previewHubSpotAudience({ name: "Nobody", filters: CUSTOMERS });
  assert.equal(preview.read, 0);
  assert.equal(preview.valid, 0);
  assert.deepEqual(preview.sample, []);
  assert.ok(preview.warnings.some((w) => /returned no contacts/.test(w)));

  await assert.rejects(
    audienceFromHubSpot(li.client, li.getToken, { accountId: "1", name: "Nobody", filters: CUSTOMERS }),
    /HubSpot search returned no contacts/,
  );
  assert.equal(li.client.calls.length, 0);
});

test("exactly 1 source: a list or filters, never both or neither", async (t) => {
  withTokenEnv(t, "pat-env");
  const calls = stubFetch(t, () => undefined);
  await assert.rejects(previewHubSpotAudience({ name: "x" }), /exactly 1 HubSpot source/);
  await assert.rejects(previewHubSpotAudience({ name: "x", listId: "1", filters: CUSTOMERS }), /exactly 1 HubSpot source/);
  assert.equal(calls.length, 0);
});

test("ADWARP_HUBSPOT_TOKEN wins over hubspot.json, and a 403 names the missing scope", async (t) => {
  withTokenEnv(t, "pat-env");
  withTokenFile(t, JSON.stringify({ accessToken: "pat-file" }));
  const calls = stubFetch(t, () =>
    json({ status: "error", message: "This app hasn't been granted all required scopes", category: "MISSING_SCOPES", context: { missingScopes: ["crm.lists.read"] } }, 403),
  );
  await assert.rejects(previewHubSpotAudience({ name: "x", listId: "5" }), /403.*Missing: crm\.lists\.read/);
  assert.equal(calls[0].headers.Authorization, "Bearer pat-env");
});

test("CLI filters parse into HubSpot search filters", () => {
  assert.deepEqual(parseHubSpotFilter("lifecyclestage:eq:customer"), { property: "lifecyclestage", operator: "EQ", value: "customer" });
  assert.deepEqual(parseHubSpotFilter("email:HAS_PROPERTY"), { property: "email", operator: "HAS_PROPERTY", value: undefined });
  const between = parseHubSpotFilter("createdate:BETWEEN:2026-01-01T00:00:00Z,2026-06-30T00:00:00Z");
  assert.deepEqual(toHubSpotSearchFilter(between), {
    propertyName: "createdate",
    operator: "BETWEEN",
    value: "2026-01-01T00:00:00Z",
    highValue: "2026-06-30T00:00:00Z",
  });
  assert.deepEqual(toHubSpotSearchFilter(parseHubSpotFilter("email:CONTAINS_TOKEN:*@acme.com")), {
    propertyName: "email",
    operator: "CONTAINS_TOKEN",
    value: "*@acme.com",
  });
  assert.throws(() => parseHubSpotFilter("lifecyclestage:LIKE:customer"), /unknown operator "LIKE"/);
  assert.throws(() => parseHubSpotFilter("lifecyclestage"), /<property>:<operator>:<value>/);
  assert.throws(() => parseHubSpotFilter("industry:IN:"), /needs a value/);
  assert.throws(() => parseHubSpotFilter("createdate:BETWEEN:2026-01-01"), /low,high/);
});
