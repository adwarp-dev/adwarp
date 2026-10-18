/**
 * Guards the promises this package makes about what it sends to Google.
 *
 * Runs against dist (`pnpm --filter @adwarp/google build` first) with a stubbed
 * transport, so it needs no credentials and never touches an ad account. The
 * assertions here are the safety rule made executable: if any of them fail, the
 * tool can create something that spends money without a human turning it on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ADWARP_GOOGLE_CLIENT_ID = "test-client";
process.env.ADWARP_GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ADWARP_GOOGLE_DEVELOPER_TOKEN = "test-token";

const { launchSearchCampaign, SearchCampaignBriefSchema, flattenGoogleAdsErrors, toMicros, fromMicros } =
  await import("../dist/index.js");

/** Records every request and answers the lookups a launch performs. */
function stubClient() {
  const calls = [];
  return {
    calls,
    version: "v25",
    async request(opts) {
      calls.push(opts);
      const q = opts.body?.query ?? "";
      if (opts.path.includes("searchStream")) {
        if (q.includes("geo_target_constant")) return [{ results: [{ geoTargetConstant: { id: "2840" } }] }];
        if (q.includes("language_constant")) return [{ results: [{ languageConstant: { id: "1000" } }] }];
        if (q.includes("conversion_action")) {
          return [{ results: [{ conversionAction: { id: "555", name: "Salesforce Opp (Zapier)", status: "ENABLED" } }] }];
        }
        return [{ results: [] }];
      }
      if (opts.path.includes(":mutate")) {
        return {
          mutateOperationResponses: opts.body.mutateOperations.map((op, i) => {
            const resultKey = Object.keys(op)[0].replace("Operation", "Result");
            return { [resultKey]: { resourceName: `customers/1234567890/x/${i + 100}` } };
          }),
        };
      }
      return {};
    },
  };
}

const BRIEF = {
  customerId: "123-456-7890",
  campaignName: "RevOps automation - Search",
  dailyBudget: 150,
  cpcBid: 12,
  finalUrl: "https://default.com/platform",
  conversionActionNames: ["Salesforce Opp (Zapier)"],
  negativeKeywords: [{ text: "jobs", matchType: "BROAD" }],
  adGroups: [
    {
      name: "RevOps automation - exact",
      cpcBid: 15,
      keywords: [
        { text: "revops automation", matchType: "EXACT" },
        { text: "revenue operations software", matchType: "PHRASE" },
      ],
      negativeKeywords: [{ text: "free", matchType: "BROAD" }],
      ads: [
        {
          headlines: ["RevOps automation", "Stop stitching GTM tools", "See Default live"],
          descriptions: ["Route, enrich, and book meetings in one platform.", "Built for teams that move fast."],
          path1: "platform",
        },
      ],
    },
    {
      name: "Lead routing - exact",
      keywords: [{ text: "lead routing software", matchType: "EXACT" }],
      ads: [
        {
          headlines: ["Lead routing that works", "Route leads in seconds", "Default for RevOps"],
          descriptions: ["Instant routing, no rules engine to babysit.", "Connect your CRM in minutes."],
        },
      ],
    },
  ],
};

const parse = (overrides = {}) => SearchCampaignBriefSchema.parse({ ...BRIEF, ...overrides });

async function buildOps(overrides = {}) {
  const client = stubClient();
  const result = await launchSearchCampaign(client, parse(overrides));
  const mutates = client.calls.filter((c) => c.path.includes(":mutate"));
  return { client, result, mutates, ops: mutates.at(-1).body.mutateOperations };
}

const opsOf = (ops, field) => ops.filter((o) => o[field]).map((o) => o[field].create);

test("nothing that can serve is created enabled", async () => {
  const { ops } = await buildOps();
  const campaign = opsOf(ops, "campaignOperation")[0];
  assert.equal(campaign.status, "PAUSED");
  for (const g of opsOf(ops, "adGroupOperation")) assert.equal(g.status, "PAUSED");
  for (const a of opsOf(ops, "adGroupAdOperation")) assert.equal(a.status, "PAUSED");
  // Keywords are the one exception: a paused keyword is dead weight, and
  // nothing serves while the campaign and ad group above it are paused.
  const positives = opsOf(ops, "adGroupCriterionOperation").filter((c) => !c.negative);
  assert.ok(positives.every((c) => c.status === "ENABLED"));
});

test("the schema cannot express an enabled campaign", () => {
  const parsed = SearchCampaignBriefSchema.safeParse({ ...BRIEF, status: "ENABLED" });
  assert.ok(parsed.success);
  assert.ok(!("status" in parsed.data), "a smuggled status field must be stripped");
});

test("house defaults are applied and cannot be overridden by the brief", async () => {
  const { ops } = await buildOps({ networkSettings: { targetContentNetwork: true } });
  const campaign = opsOf(ops, "campaignOperation")[0];
  assert.deepEqual(campaign.networkSettings, {
    targetGoogleSearch: true,
    targetSearchNetwork: false,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  });
  assert.equal(campaign.geoTargetTypeSetting.positiveGeoTargetType, "PRESENCE");
  assert.equal(campaign.manualCpc.enhancedCpcEnabled, false);
  assert.equal(campaign.containsEuPoliticalAdvertising, "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING");
});

test("every write is validated server-side before anything is persisted", async () => {
  const dry = await buildOps({ validateOnly: true });
  assert.equal(dry.mutates.length, 1);
  assert.equal(dry.mutates[0].body.validateOnly, true);
  assert.equal(dry.mutates[0].isRead, true, "a validate-only call must not be journaled");
  assert.deepEqual(dry.result.adGroupIds, []);

  const real = await buildOps({ validateOnly: false });
  assert.equal(real.mutates.length, 2, "a real run validates first, then writes");
  assert.equal(real.mutates[0].body.validateOnly, true);
  assert.equal(real.mutates[1].body.validateOnly, false);
  assert.equal(real.result.adGroupIds.length, 2);
});

test("temporary resource names go only on referenced parents, are unique, and are defined before use", async () => {
  const { ops } = await buildOps();
  const PARENTS = ["campaignBudgetOperation", "campaignOperation", "adGroupOperation"];

  const names = [];
  for (const op of ops) {
    const [field, { create }] = Object.entries(op)[0];
    if (PARENTS.includes(field)) {
      assert.match(create.resourceName, /\/-\d+$/, `${field} needs a temp name for its children to point at`);
      names.push(create.resourceName);
    } else {
      // Live Google rejects a temp name on composite-key leaves (criteria, ads,
      // shared-set links) with BAD_RESOURCE_ID. They must go in unnamed.
      assert.equal(create.resourceName, undefined, `${field} must not carry a temp resource name`);
    }
  }
  assert.equal(new Set(names).size, names.length, "temp ids must be unique across the whole request");

  // Google resolves temp names in order, so a reference may only point backwards.
  const seen = new Set();
  for (const op of ops) {
    const create = Object.values(op)[0].create;
    for (const ref of [create.campaignBudget, create.campaign, create.adGroup]) {
      if (ref) assert.ok(seen.has(ref), `${ref} referenced before it was created`);
    }
    if (create.resourceName) seen.add(create.resourceName);
  }
});

test("the hierarchy is wired to the right parents", async () => {
  const { ops, result } = await buildOps();
  const campaign = opsOf(ops, "campaignOperation")[0];
  const budget = opsOf(ops, "campaignBudgetOperation")[0];
  const groups = opsOf(ops, "adGroupOperation");
  const criteria = opsOf(ops, "adGroupCriterionOperation");

  assert.equal(campaign.campaignBudget, budget.resourceName);
  assert.equal(budget.amountMicros, 150_000_000);
  assert.ok(opsOf(ops, "campaignCriterionOperation").every((c) => c.campaign === campaign.resourceName));
  assert.equal(criteria.filter((c) => c.adGroup === groups[0].resourceName).length, 3);
  assert.equal(criteria.filter((c) => c.adGroup === groups[1].resourceName).length, 1);
  assert.equal(result.keywordCount, 3);
  assert.equal(result.customerId, "1234567890", "customer id must be sent without hyphens");
});

test("bids fall back from ad group to campaign", async () => {
  const { ops } = await buildOps();
  const groups = opsOf(ops, "adGroupOperation");
  assert.equal(groups[0].cpcBidMicros, 15_000_000, "ad group bid wins");
  assert.equal(groups[1].cpcBidMicros, 12_000_000, "campaign bid is the fallback");
});

test("responsive search ads are shaped the way Google expects", async () => {
  const { ops } = await buildOps();
  const [first, second] = opsOf(ops, "adGroupAdOperation");
  const rsa = first.ad.responsiveSearchAd;
  assert.deepEqual(rsa.headlines[0], { text: "RevOps automation" });
  assert.equal(rsa.descriptions.length, 2);
  assert.equal(rsa.path1, "platform");
  assert.equal(second.ad.responsiveSearchAd.path1, undefined, "empty paths are omitted, not sent as ''");
  assert.deepEqual(first.ad.finalUrls, ["https://default.com/platform"]);
});

test("targeting constants resolve rather than being hard-coded", async () => {
  const { ops } = await buildOps();
  const criteria = opsOf(ops, "campaignCriterionOperation");
  assert.ok(criteria.some((c) => c.location?.geoTargetConstant === "geoTargetConstants/2840"));
  assert.ok(criteria.some((c) => c.language?.languageConstant === "languageConstants/1000"));
  assert.ok(criteria.some((c) => c.negative === true && c.keyword.text === "jobs"));
});

test("a brief that would waste a live call is rejected first", () => {
  const group = BRIEF.adGroups[0];
  const bad = (overrides, why) =>
    assert.equal(SearchCampaignBriefSchema.safeParse({ ...BRIEF, ...overrides }).success, false, why);

  bad({ dailyBudget: -5 }, "negative budget");
  bad({ dailyBudget: undefined }, "no budget at all");
  bad({ finalUrl: "not-a-url" }, "malformed final URL");
  bad({ adGroups: [] }, "no ad groups");
  bad({ adGroups: [{ ...group, keywords: [] }] }, "ad group with no keywords");
  bad({ adGroups: [{ ...group, ads: [{ headlines: ["a", "b"], descriptions: ["a", "b"] }] }] }, "under 3 headlines");
  bad({ adGroups: [{ ...group, ads: [{ headlines: ["a", "b", "c"], descriptions: ["a"] }] }] }, "under 2 descriptions");
  bad(
    { adGroups: [{ ...group, ads: [{ headlines: ["x".repeat(31), "b", "c"], descriptions: ["a", "b"] }] }] },
    "headline over 30 chars",
  );
  bad(
    { adGroups: [{ ...group, ads: [{ headlines: ["a", "b", "c"], descriptions: ["x".repeat(91), "b"] }] }] },
    "description over 90 chars",
  );
  // Live Google: fieldError.VALUE_MUST_BE_UNSET on responsive_search_ad.path2.
  bad(
    { adGroups: [{ ...group, ads: [{ headlines: ["a", "b", "c"], descriptions: ["a", "b"], path2: "routing" }] }] },
    "path2 without path1",
  );
});

test("a missing conversion action warns instead of failing silently", async () => {
  const { result } = await buildOps({ conversionActionNames: ["Nonexistent Action"] });
  assert.ok(result.warnings.some((w) => w.includes("Nonexistent Action") && w.includes("not found")));

  const none = await buildOps({ conversionActionNames: [] });
  assert.ok(none.result.warnings.some((w) => w.includes("No conversion actions")));
});

test("GoogleAdsFailure is flattened into something actionable", () => {
  const { errors, requestId } = flattenGoogleAdsErrors({
    error: {
      status: "INVALID_ARGUMENT",
      details: [
        {
          requestId: "abc123",
          errors: [
            {
              errorCode: { fieldError: "REQUIRED" },
              message: "The required field was not present.",
              location: {
                fieldPathElements: [
                  { fieldName: "operations", index: 0 },
                  { fieldName: "create" },
                  { fieldName: "campaign_budget" },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].codeGroup, "fieldError");
  assert.equal(errors[0].code, "REQUIRED");
  assert.equal(errors[0].fieldPath, "operations[0].create.campaign_budget");
  assert.equal(requestId, "abc123");
  assert.deepEqual(flattenGoogleAdsErrors({ nonsense: true }).errors, []);
});

test("a searchStream failure is flattened even though it arrives array-wrapped", () => {
  // Live 403 shape from googleAds:searchStream: the error rides inside the
  // stream's chunk array rather than at the top level.
  const { errors, requestId } = flattenGoogleAdsErrors([
    {
      error: {
        code: 403,
        message: "The caller does not have permission",
        status: "PERMISSION_DENIED",
        details: [
          {
            requestId: "M3L14hMaud2EA0q7VJNwKg",
            errors: [
              {
                errorCode: { authorizationError: "DEVELOPER_TOKEN_NOT_APPROVED" },
                message:
                  "The developer token is only approved for use with test accounts. To access non-test accounts, apply for Basic or Standard access.",
              },
            ],
          },
        ],
      },
    },
  ]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].codeGroup, "authorizationError");
  assert.equal(errors[0].code, "DEVELOPER_TOKEN_NOT_APPROVED");
  assert.equal(errors[0].fieldPath, undefined, "an authorization error has no field path");
  assert.equal(requestId, "M3L14hMaud2EA0q7VJNwKg");
});

test("money converts through micros without drift", () => {
  assert.equal(toMicros("12.34"), 12_340_000);
  assert.equal(toMicros(0.01), 10_000);
  assert.equal(fromMicros("12340000"), 12.34);
  assert.equal(fromMicros(10_000), 0.01);
});
