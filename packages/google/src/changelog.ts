import { recordChange, type AdEntityType, type ChangeInput } from "@adwarp/shared";
import type { GoogleMutationEvent } from "./http.js";
import { createdResourceNames, idFromResourceName } from "./mutate.js";

/**
 * Google's half of the change journal. Writes land in the same
 * changelog.jsonl as LinkedIn's, tagged `platform: "google"`, so one
 * `changelog list` shows every change across both platforms in order.
 */

/** Mutate result keys mapped to the entity type the journal tracks. */
const RESULT_TYPE: Record<string, { type: AdEntityType; label: string }> = {
  campaignBudgetResult: { type: "campaign", label: "budget" },
  campaignResult: { type: "campaign", label: "campaign" },
  adGroupResult: { type: "adGroup", label: "ad group" },
  adGroupAdResult: { type: "ad", label: "ad" },
  adGroupCriterionResult: { type: "keyword", label: "keyword" },
};

/**
 * Turn a successful `googleAds:mutate` into one change event per created
 * entity. Validate-only calls never reach here: the client marks them as reads.
 */
export function interpretGoogleMutation(m: GoogleMutationEvent): ChangeInput[] {
  if (!m.path.includes(":mutate")) return [];
  const created = createdResourceNames(m.response as any);

  const changes: ChangeInput[] = [];
  for (const [resultKey, resourceNames] of Object.entries(created)) {
    const mapped = RESULT_TYPE[resultKey];
    if (!mapped) continue;
    // Criteria and ads come in bulk; one line each would drown the journal, so
    // they are summarized as a count against their parent operation.
    if (mapped.type === "keyword") {
      changes.push({
        platform: "google",
        source: "adwarp",
        kind: "create",
        entity: { type: "keyword", id: `${resourceNames.length} criteria`, accountId: m.customerId },
        summary: `Created ${resourceNames.length} keyword criteria`,
      });
      continue;
    }
    for (const resourceName of resourceNames) {
      changes.push({
        platform: "google",
        source: "adwarp",
        kind: "create",
        entity: {
          type: mapped.type,
          id: resourceName.includes("~") ? resourceName.split("~").pop()! : idFromResourceName(resourceName),
          accountId: m.customerId,
        },
        summary: `Created ${mapped.label}`,
      });
    }
  }
  return changes;
}

/** The onMutation hook wired into the Google client. */
export async function recordGoogleMutation(m: GoogleMutationEvent): Promise<void> {
  for (const change of interpretGoogleMutation(m)) await recordChange(change);
}
