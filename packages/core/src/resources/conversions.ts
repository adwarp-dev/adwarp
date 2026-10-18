import type { LinkedInClient } from "../http.js";
import { sponsoredAccountUrn, campaignUrn } from "../urns.js";

/**
 * Conversions (insight-tag based) live at the account level. Adwarp never creates
 * them; it lists existing ones and associates campaigns with a selected one.
 *
 * IMPORTANT: `associatedCampaigns` is read-only. The writable `campaigns` field
 * is an array of campaign URNs that REPLACES wholesale on update (no $add). To
 * attach a campaign we must read the current list, append, and set it back —
 * never dropping existing associations.
 */

export interface Conversion {
  id: number;
  name: string;
  type: string;
  enabled: boolean;
  /** Writable: campaign URNs associated with this conversion. */
  campaigns?: string[];
}

/** List the account's conversions. */
export async function listConversions(client: LinkedInClient, accountId: string): Promise<Conversion[]> {
  const res = await client.request<{ elements: Conversion[] }>({
    path: "/conversions",
    query: { q: "account", account: sponsoredAccountUrn(accountId) },
  });
  return res.data.elements ?? [];
}

export async function getConversion(
  client: LinkedInClient,
  accountId: string,
  conversionId: string,
): Promise<Conversion> {
  const res = await client.request<Conversion>({
    path: `/conversions/${conversionId}`,
    query: { account: sponsoredAccountUrn(accountId) },
  });
  return res.data;
}

/** Resolve a conversion id by exact (case-insensitive) name, preferring enabled ones. */
export async function resolveConversionIdByName(
  client: LinkedInClient,
  accountId: string,
  name: string,
): Promise<string | undefined> {
  const all = await listConversions(client, accountId);
  const matches = all.filter((c) => (c.name ?? "").toLowerCase() === name.toLowerCase());
  const chosen = matches.find((c) => c.enabled) ?? matches[0];
  return chosen ? String(chosen.id) : undefined;
}

/**
 * Associate a campaign with a conversion without clobbering existing
 * associations: read the current `campaigns`, append, and set the full list.
 * No-op if already associated.
 */
export async function associateCampaignWithConversion(
  client: LinkedInClient,
  accountId: string,
  conversionId: string,
  campaignId: string,
): Promise<{ added: boolean; total: number }> {
  const conv = await getConversion(client, accountId, conversionId);
  const current = Array.isArray(conv.campaigns) ? conv.campaigns : [];
  const urn = campaignUrn(campaignId);
  if (current.includes(urn)) return { added: false, total: current.length };
  const updated = [...current, urn];
  await client.request({
    method: "POST",
    path: `/conversions/${conversionId}`,
    query: { account: sponsoredAccountUrn(accountId) },
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: { patch: { $set: { campaigns: updated } } },
  });
  return { added: true, total: updated.length };
}
