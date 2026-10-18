import {
  computeChangeLift,
  readChanges,
  recordChange,
  type ChangeEvent,
  type ChangeInput,
  type ChangeLift as SharedChangeLift,
  type LiftWindow as SharedLiftWindow,
  type LiftWindowSpec,
} from "@adwarp/shared";
import type { LinkedInClient, MutationEvent } from "./http.js";
import {
  fetchAnalytics,
  type AnalyticsPivot,
  type DateRange,
  type FilterType,
  type LiDate,
} from "./resources/analytics.js";
import { aggregate, normalize, type MetricRow } from "./report.js";
import { idFromUrn } from "./urns.js";

/**
 * LinkedIn's half of the change journal. The journal model, its JSONL storage,
 * and the before/after windowing are platform-neutral and live in
 * @adwarp/shared; what stays here is LinkedIn-specific: turning a restli write
 * into a change event, and pulling LinkedIn analytics for a lift window.
 */

// Re-exported so `import { ... } from "@adwarp/core"` keeps working unchanged.
export {
  changelogPath,
  recordChange,
  readChanges,
  eventPlatform,
} from "@adwarp/shared";
export type {
  AdEntityType,
  AdPlatform,
  ChangedField,
  ChangeEvent,
  ChangeInput,
  ChangeFilter,
} from "@adwarp/shared";

/** The three ad entities LinkedIn exposes, and the only ones it can report on. */
export type LinkedInEntityType = "campaignGroup" | "campaign" | "creative";

export type LiftWindow = SharedLiftWindow<MetricRow>;
export type ChangeLift = SharedChangeLift<MetricRow>;

/* ------------------------------ auto-capture -------------------------------- */

const COLLECTION_TYPE: Record<string, LinkedInEntityType> = {
  adCampaignGroups: "campaignGroup",
  adCampaigns: "campaign",
  creatives: "creative",
};

const TYPE_LABEL: Record<LinkedInEntityType, string> = {
  campaignGroup: "campaign group",
  campaign: "campaign",
  creative: "creative (ad)",
};

const fmtVal = (v: unknown): string =>
  v === null || v === undefined ? "(none)" : typeof v === "object" ? JSON.stringify(v) : String(v);

/**
 * Creatives are addressed by URN: percent-encoded in an update path, bare in a
 * create's x-restli-id. Journal the numeric id, which `lift` and
 * `changelog list -i` take, so every change to an ad lands under the same id.
 */
const journalId = (raw: string): string => idFromUrn(decodeURIComponent(raw));

/**
 * Translate a raw HTTP write into a structured change event, or null if it isn't
 * one of the three tracked management endpoints. Creates are POSTs to a
 * collection (id comes back in restliId); updates are POSTs to a specific id
 * carrying a `patch.$set`. Anchored on the path tail so sibling endpoints (e.g.
 * conversion association) are ignored.
 */
export function interpretMutation(m: MutationEvent): ChangeInput | null {
  if (m.method === "GET" || m.status >= 300) return null;
  const match = m.path.match(/\/adAccounts\/(\d+)\/(adCampaignGroups|adCampaigns|creatives)(?:\/([^/?]+))?$/);
  if (!match) return null;
  const [, accountId, collection, idSeg] = match;
  const type = COLLECTION_TYPE[collection!]!;
  const body = (m.body ?? {}) as Record<string, any>;

  // Update: PARTIAL_UPDATE patch against an existing entity id.
  const set = body?.patch?.$set as Record<string, unknown> | undefined;
  if (idSeg && set && typeof set === "object") {
    const fields = Object.entries(set).map(([field, after]) => ({ field, after }));
    return {
      platform: "linkedin",
      source: "adwarp",
      kind: "update",
      entity: { type, id: journalId(idSeg), accountId },
      fields,
      summary: fields.map((f) => `${f.field} → ${fmtVal(f.after)}`).join(", "),
    };
  }

  // Create: POST to the collection; the new id arrives in the x-restli-id header.
  if (!idSeg) {
    const id = m.restliId;
    if (!id) return null;
    const name: string | undefined = body?.name ?? body?.creative?.name;
    return {
      platform: "linkedin",
      source: "adwarp",
      kind: "create",
      entity: { type, id: journalId(id), name, accountId },
      summary: `Created ${TYPE_LABEL[type]}${name ? ` “${name}”` : ""}`,
    };
  }
  return null;
}

/** The onMutation hook wired into the client: interpret a write and journal it. */
export async function recordMutation(m: MutationEvent): Promise<void> {
  const change = interpretMutation(m);
  if (change) await recordChange(change);
}

/* ---------------------------------- lift ------------------------------------ */

const PIVOT_FILTER: Record<LinkedInEntityType, { pivot: AnalyticsPivot; filterType: FilterType }> = {
  campaignGroup: { pivot: "CAMPAIGN_GROUP", filterType: "campaignGroups" },
  campaign: { pivot: "CAMPAIGN", filterType: "campaigns" },
  creative: { pivot: "CREATIVE", filterType: "creatives" },
};

/** The KPIs a lift report compares across a change boundary. */
export const LIFT_METRICS = [
  "impressions",
  "clicks",
  "costUsd",
  "conversions",
  "ctr",
  "cpc",
  "cvr",
  "costPerConversion",
] as const;

/** "YYYY-MM-DD" to LinkedIn's date shape. */
function toLiDate(iso: string): LiDate {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year!, month: month!, day: day! };
}

async function windowMetrics(
  client: LinkedInClient,
  type: LinkedInEntityType,
  entityId: string,
  window: LiftWindowSpec,
): Promise<MetricRow> {
  const { pivot, filterType } = PIVOT_FILTER[type];
  const range: DateRange = { start: toLiDate(window.start), end: toLiDate(window.end) };
  const raw = await fetchAnalytics(client, { pivot, timeGranularity: "ALL", dateRange: range, filterType, ids: [entityId] });
  return aggregate(raw.map(normalize));
}

/**
 * For each recorded change to an entity, compare LinkedIn performance in the
 * `windowDays` before the change against the `windowDays` after.
 *
 * This is a directional pre/post comparison, not a controlled experiment — it is
 * confounded by seasonality, the LinkedIn learning phase after an edit, and any
 * concurrent budget change. Read the deltas as a signal, not proof.
 */
export async function computeLift(
  client: LinkedInClient,
  opts: { type: LinkedInEntityType; entityId: string; windowDays?: number; now?: Date; changes?: ChangeEvent[] },
): Promise<ChangeLift[]> {
  const changes =
    opts.changes ?? (await readChanges({ platform: "linkedin", type: opts.type, id: opts.entityId }));
  return computeChangeLift<MetricRow>({
    changes,
    windowDays: opts.windowDays,
    now: opts.now,
    metricKeys: LIFT_METRICS,
    fetch: (window) => windowMetrics(client, opts.type, opts.entityId, window),
    empty: aggregate([]),
  });
}

/* -------------------------------- helpers ----------------------------------- */

/** Map a report-style level ("campaign_group") or an entity type to a LinkedIn entity. */
export function normalizeEntityType(input: string): LinkedInEntityType {
  switch (input) {
    case "campaign_group":
    case "campaignGroup":
    case "group":
      return "campaignGroup";
    case "campaign":
      return "campaign";
    case "creative":
    case "ad":
      return "creative";
    default:
      throw new Error(`Unknown entity type "${input}". Use campaignGroup | campaign | creative.`);
  }
}
