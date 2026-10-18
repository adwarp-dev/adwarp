import type { GoogleAdsClient } from "./http.js";
import { MutateBatch, runMutate, toMicros, createdResourceNames, idFromResourceName } from "./mutate.js";
import { resolveGeoTarget, resolveLanguage } from "./resources/constants.js";
import { resolveConversionActions } from "./resources/conversions.js";
import { loadGoogleConfig, resolveDefaultConversionActionNames, requireCustomerId } from "./config.js";
import type { SearchCampaignBriefInput, KeywordInput } from "./schemas.js";

/**
 * House defaults, applied to every campaign this tool creates.
 *
 * These are the two settings that quietly waste the most B2B budget on Google,
 * and both default the wrong way in the UI. They are constants, not options,
 * for the same reason Adwarp has no activate tool: the guardrail is worth more
 * than the flexibility.
 */
export const NETWORK_SETTINGS = {
  targetGoogleSearch: true,
  /** Search partners: other people's search boxes. Off. */
  targetSearchNetwork: false,
  /** "Display expansion" on a Search campaign. The biggest silent leak. Off. */
  targetContentNetwork: false,
  targetPartnerSearchNetwork: false,
} as const;

/**
 * Physical presence, not "presence or interest". The default targets anyone who
 * merely searched about the location, which for a US B2B campaign means paying
 * for clicks from everywhere.
 */
export const GEO_TARGET_TYPE_SETTING = {
  positiveGeoTargetType: "PRESENCE",
  negativeGeoTargetType: "PRESENCE",
} as const;

export interface LaunchPlanEntity {
  kind: string;
  name: string;
  detail?: string;
}

export interface GoogleLaunchResult {
  customerId: string;
  /** True when nothing was persisted: Google validated the batch and discarded it. */
  validateOnly: boolean;
  /** Human-readable summary of what the batch creates, for confirmation before a real run. */
  plan: LaunchPlanEntity[];
  /** Operation count in the batch. */
  operations: number;
  campaignId?: string;
  campaignResourceName?: string;
  adGroupIds: string[];
  adIds: string[];
  keywordCount: number;
  warnings: string[];
  links: { campaigns: string };
}

const keywordCriterion = (kw: KeywordInput) => ({ keyword: { text: kw.text, matchType: kw.matchType } });

/**
 * Create a paused Search campaign from a brief, in one atomic mutate.
 *
 * Order matters: Google resolves temporary resource names sequentially, so the
 * budget must be added before the campaign that references it, and the ad group
 * before its keywords and ads. Only budget, campaign, and ad groups carry temp
 * names; criteria, ads, and shared-set links are leaves and go in unnamed.
 *
 * Nothing here can create an enabled entity. The campaign, its ad groups, and
 * its ads are all PAUSED; only keyword criteria are ENABLED, because a paused
 * keyword is dead weight and nothing serves while its parents are paused.
 */
export async function launchSearchCampaign(
  client: GoogleAdsClient,
  brief: SearchCampaignBriefInput,
): Promise<GoogleLaunchResult> {
  const customerId = await requireCustomerId(brief.customerId);
  const warnings: string[] = [];
  const plan: LaunchPlanEntity[] = [];

  // Resolve targeting constants and conversion actions before building anything,
  // so a typo fails fast with a clear message instead of inside a mutate error.
  const geoTargets = await Promise.all(brief.locations.map((l) => resolveGeoTarget(client, customerId, l)));
  const languages = await Promise.all(brief.languages.map((l) => resolveLanguage(client, customerId, l)));

  const conversionNames =
    brief.conversionActionNames ?? resolveDefaultConversionActionNames(await loadGoogleConfig());
  if (conversionNames.length) {
    const { found, missing } = await resolveConversionActions(client, customerId, conversionNames);
    for (const m of missing) warnings.push(`Conversion action "${m}" not found on this account.`);
    if (found.length) {
      warnings.push(
        `Conversion actions verified: ${found.map((f) => f.name).join(", ")}. Google applies account-level conversion goals by default; confirm this campaign's goals in the UI if it should track a narrower set.`,
      );
    }
  } else {
    warnings.push(
      "No conversion actions named and none configured as a default. The campaign will inherit the account's conversion goals. Set defaultConversionActionNames in ~/.liads/google.json to make this explicit.",
    );
  }

  const batch = new MutateBatch(customerId);

  // 1. Budget. Required, and the only hard spend cap before activation.
  const budgetName = brief.budgetName ?? `${brief.campaignName} budget`;
  const budget = batch.create("campaignBudgetOperation", "campaignBudgets", {
    name: budgetName,
    amountMicros: toMicros(brief.dailyBudget),
    deliveryMethod: "STANDARD",
    explicitlyShared: false,
  });
  plan.push({ kind: "Budget", name: budgetName, detail: `${brief.dailyBudget}/day, not shared` });

  // 2. Campaign, paused, with the house settings baked in.
  const campaign = batch.create("campaignOperation", "campaigns", {
    name: brief.campaignName,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    campaignBudget: budget,
    manualCpc: { enhancedCpcEnabled: false },
    networkSettings: NETWORK_SETTINGS,
    geoTargetTypeSetting: GEO_TARGET_TYPE_SETTING,
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    ...(brief.startDateTime ? { startDateTime: brief.startDateTime } : {}),
    ...(brief.endDateTime ? { endDateTime: brief.endDateTime } : {}),
  });
  plan.push({
    kind: "Campaign",
    name: brief.campaignName,
    detail: "SEARCH, PAUSED, Manual CPC, search-only network, presence-only geo",
  });

  // 3. Campaign criteria: where and in what language, plus any negatives.
  for (const geoTargetConstant of geoTargets) {
    batch.add("campaignCriterionOperation", { campaign, location: { geoTargetConstant } });
  }
  for (const languageConstant of languages) {
    batch.add("campaignCriterionOperation", { campaign, language: { languageConstant } });
  }
  plan.push({
    kind: "Targeting",
    name: `${brief.locations.join(", ")} / ${brief.languages.join(", ")}`,
    detail: "physical presence only",
  });

  for (const kw of brief.negativeKeywords ?? []) {
    batch.add("campaignCriterionOperation", {
      campaign,
      negative: true,
      ...keywordCriterion(kw),
    });
  }
  if (brief.negativeKeywords?.length) {
    plan.push({ kind: "Campaign negatives", name: `${brief.negativeKeywords.length} keywords` });
  }

  if (brief.negativeKeywordListId) {
    batch.add("campaignSharedSetOperation", {
      campaign,
      sharedSet: `customers/${customerId}/sharedSets/${brief.negativeKeywordListId}`,
    });
    plan.push({ kind: "Negative list", name: brief.negativeKeywordListId });
  }

  // 4. Ad groups, each with its keywords and ads.
  let keywordCount = 0;
  for (const group of brief.adGroups) {
    const bid = group.cpcBid ?? brief.cpcBid;
    const adGroup = batch.create("adGroupOperation", "adGroups", {
      name: group.name,
      campaign,
      status: "PAUSED",
      type: "SEARCH_STANDARD",
      ...(bid ? { cpcBidMicros: toMicros(bid) } : {}),
    });
    plan.push({
      kind: "Ad group",
      name: group.name,
      detail: `PAUSED${bid ? `, max CPC ${bid}` : ""}, ${group.keywords.length} keywords, ${group.ads.length} ads`,
    });

    for (const kw of group.keywords) {
      batch.add("adGroupCriterionOperation", {
        adGroup,
        status: "ENABLED",
        ...keywordCriterion(kw),
      });
      keywordCount++;
    }
    for (const kw of group.negativeKeywords ?? []) {
      batch.add("adGroupCriterionOperation", {
        adGroup,
        negative: true,
        ...keywordCriterion(kw),
      });
    }

    for (const ad of group.ads) {
      batch.add("adGroupAdOperation", {
        adGroup,
        status: "PAUSED",
        ad: {
          finalUrls: [ad.finalUrl ?? brief.finalUrl],
          responsiveSearchAd: {
            headlines: ad.headlines.map((text) => ({ text })),
            descriptions: ad.descriptions.map((text) => ({ text })),
            ...(ad.path1 ? { path1: ad.path1 } : {}),
            ...(ad.path2 ? { path2: ad.path2 } : {}),
          },
        },
      });
    }
  }

  // 5. Always validate server-side first. Google runs the whole batch through
  // its validators and persists nothing, so a malformed brief costs one call
  // rather than a half-built campaign.
  await runMutate(client, batch, { validateOnly: true });

  const base = {
    customerId,
    plan,
    operations: batch.size,
    keywordCount,
    warnings,
    links: { campaigns: `https://ads.google.com/aw/campaigns?__c=${customerId}` },
  };

  if (brief.validateOnly) {
    return { ...base, validateOnly: true, adGroupIds: [], adIds: [] };
  }

  const res = await runMutate(client, batch, { validateOnly: false });
  const created = createdResourceNames(res);
  const campaignResourceName = created.campaignResult?.[0];

  return {
    ...base,
    validateOnly: false,
    campaignResourceName,
    campaignId: campaignResourceName ? idFromResourceName(campaignResourceName) : undefined,
    adGroupIds: (created.adGroupResult ?? []).map(idFromResourceName),
    adIds: (created.adGroupAdResult ?? []).map((rn) => rn.split("~").pop() ?? rn),
  };
}
