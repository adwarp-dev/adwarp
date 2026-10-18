import type { LinkedInAds } from "./client.js";
import type { LaunchFromBriefInput } from "./schemas.js";
import { uploadAudienceFromFile } from "./audience.js";
import { createCampaignGroup } from "./resources/campaignGroups.js";
import { createCampaign } from "./resources/campaigns.js";
import { createTextAdCreative } from "./resources/creatives.js";
import { createSponsoredImageDraft } from "./creative.js";
import { estimateAudience, MIN_AUDIENCE_TO_SERVE, geoSegmentSpec, type TargetingSpec } from "./resources/targeting.js";
import { resolveConversionIdByName } from "./resources/conversions.js";
import { loadConfig, resolveDefaultConversionNames } from "./config.js";
import { campaignManagerGroupLink, campaignManagerCampaignLink } from "./urns.js";

export interface LaunchResult {
  campaignGroupId: string;
  campaignId: string;
  audienceSegmentUrn?: string;
  creativeIds: string[];
  warnings: string[];
  links: { campaignGroup: string; campaign: string };
}

/**
 * One call: optional audience upload -> campaign group -> campaign -> draft
 * creatives. Everything is created DRAFT/PAUSED. Returns Campaign Manager links
 * for human review before anything is activated.
 */
export async function launchFromBrief(
  linkedinAds: LinkedInAds,
  input: LaunchFromBriefInput,
): Promise<LaunchResult> {
  const { client, getToken } = linkedinAds;
  const warnings: string[] = [];

  // 1. Audience (optional, requires Audiences/DMP product). The adSegment urn is
  // only available once matching completes (up to 48h), so it can't be attached
  // to the campaign in this same run — we surface the segment id to attach later.
  const audienceSegmentUrn: string | undefined = undefined;
  if (input.audience) {
    const result = await uploadAudienceFromFile(client, getToken, {
      accountId: input.accountId,
      name: input.audience.name,
      csvPath: input.audience.csvPath,
    });
    warnings.push(...result.warnings);
    warnings.push(
      `Audience "${input.audience.name}" uploaded as segment ${result.segmentId} (${result.uploaded} hashed emails). Attach its adSegment urn to this campaign once it is READY.`,
    );
  }

  // Targeting = geo (default US) ANDed with any structured facets from the brief.
  const spec: TargetingSpec = {
    include: { locations: input.geoUrns, ...(input.targeting?.include ?? {}) },
    exclude: input.targeting?.exclude,
  };

  // Best-effort sanity check that the audience can serve.
  try {
    const est = await estimateAudience(client, spec);
    if (!est.canServe) {
      warnings.push(`Estimated audience is ${est.total}, below the ${MIN_AUDIENCE_TO_SERVE} minimum to serve.`);
    }
  } catch {
    // Estimate is best-effort; don't block the launch on it.
  }

  // Resolve the conversion(s) to track: explicit ids, else an explicit name,
  // else the config default list (defaultConversionNames).
  let conversionIds = input.conversionIds ?? [];
  if (conversionIds.length === 0) {
    const names = input.conversionName
      ? [input.conversionName]
      : resolveDefaultConversionNames(await loadConfig());
    const resolved: string[] = [];
    for (const name of names) {
      const id = await resolveConversionIdByName(client, input.accountId, name);
      if (id) resolved.push(id);
      else warnings.push(`Conversion "${name}" not found in this account; skipped.`);
    }
    conversionIds = resolved;
  }

  // 2. Campaign group (DRAFT). runSchedule is required even for drafts.
  const group = await createCampaignGroup(client, {
    accountId: input.accountId,
    name: input.campaignGroupName,
    status: "DRAFT",
    runSchedule: input.runSchedule,
  });

  // 3. Campaign (DRAFT): targeting, budget, bid live here.
  const campaign = await createCampaign(client, {
    accountId: input.accountId,
    campaignGroupId: group.id,
    name: input.campaignName,
    type: input.type,
    costType: "CPM",
    dailyBudget: input.dailyBudget,
    unitCost: input.bid,
    locale: { country: "US", language: "en" },
    runSchedule: input.runSchedule,
    status: "DRAFT",
    creativeSelection: input.creativeSelection,
    targeting: spec,
    politicalIntent: "NOT_POLITICAL",
    applyDefaultExclusions: true,
    // Conversion is resolved above (explicit id, brief name, or config default).
    applyDefaultConversion: false,
    conversionIds,
  });
  if (conversionIds.length) warnings.push(`Tracking ${conversionIds.length} conversion(s) on the campaign.`);

  // 4. Draft creatives.
  const creativeIds: string[] = [];
  for (const c of input.creatives ?? []) {
    if ("organizationUrn" in c) {
      const draft = await createSponsoredImageDraft(client, getToken, {
        ...c,
        accountId: input.accountId,
        campaignId: campaign.id,
      });
      if (draft.creativeId) creativeIds.push(draft.creativeId);
      if (draft.note) warnings.push(draft.note);
    } else {
      const draft = await createTextAdCreative(client, {
        ...c,
        accountId: input.accountId,
        campaignId: campaign.id,
        status: "DRAFT",
      });
      creativeIds.push(draft.id);
    }
  }

  return {
    campaignGroupId: group.id,
    campaignId: campaign.id,
    audienceSegmentUrn,
    creativeIds,
    warnings,
    links: {
      campaignGroup: campaignManagerGroupLink(input.accountId, group.id),
      campaign: campaignManagerCampaignLink(input.accountId, campaign.id),
    },
  };
}
