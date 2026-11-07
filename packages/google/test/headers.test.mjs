/**
 * Pins what every Google Ads request carries after the developer token sunset
 * (2026-09-09): a bearer token, login-customer-id only when configured, and never
 * a developer-token header, which Google ignores today and says a future major
 * version will reject. Runs against dist with a stubbed fetch, so it needs no
 * credentials and never reaches Google.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const { GoogleAdsClient, GoogleAdsApiError } = await import("../dist/index.js");

function stubFetch(respond) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return respond();
  };
  return { calls, restore: () => (globalThis.fetch = original) };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("requests carry no developer-token header, even when google.json still has one", async () => {
  const stub = stubFetch(() => json(200, { resourceNames: ["customers/1"] }));
  try {
    const config = { clientId: "id", clientSecret: "secret", developerToken: "old-token" };
    const client = new GoogleAdsClient(config, async () => "access-token");
    await client.request({ method: "GET", path: "/customers:listAccessibleCustomers", isRead: true });
    const headers = stub.calls[0].headers;
    assert.equal(headers.Authorization, "Bearer access-token");
    assert.equal(Object.keys(headers).some((h) => h.toLowerCase() === "developer-token"), false);
    assert.equal("login-customer-id" in headers, false);
  } finally {
    stub.restore();
  }
});

test("a config without a developer token works, and login-customer-id is sent without hyphens", async () => {
  const stub = stubFetch(() => json(200, { resourceNames: [] }));
  try {
    const config = { clientId: "id", clientSecret: "secret", loginCustomerId: "352-005-1864" };
    const client = new GoogleAdsClient(config, async () => "access-token");
    await client.request({ method: "GET", path: "/customers:listAccessibleCustomers", isRead: true });
    assert.equal(stub.calls[0].headers["login-customer-id"], "3520051864");
  } finally {
    stub.restore();
  }
});

test("a Test-only Cloud project gets told where to apply for Explorer", async () => {
  const stub = stubFetch(() =>
    json(403, {
      error: {
        code: 403,
        message: "The caller does not have permission",
        details: [
          {
            "@type": "type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure",
            errors: [
              {
                errorCode: { authorizationError: "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION" },
                message: "The Google Cloud project is not approved to access production accounts.",
              },
            ],
          },
        ],
      },
    }),
  );
  try {
    const client = new GoogleAdsClient({ clientId: "id", clientSecret: "secret" }, async () => "access-token");
    await assert.rejects(
      client.request({ method: "GET", path: "/customers:listAccessibleCustomers", isRead: true }),
      (err) =>
        err instanceof GoogleAdsApiError &&
        err.message.includes("CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION") &&
        err.message.includes("Apply for Explorer access"),
    );
  } finally {
    stub.restore();
  }
});
