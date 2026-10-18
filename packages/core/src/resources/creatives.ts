import type { LinkedInClient } from "../http.js";
import { campaignUrn, sponsoredAccountUrn } from "../urns.js";
import type { CreatedEntity } from "./campaignGroups.js";

/**
 * Creatives (ads) use LinkedIn's unified Creatives API. A creative's
 * `intendedStatus` is independent of its parent; we default to DRAFT so nothing
 * serves until explicitly activated.
 */

/** Create a creative that references an existing post (ugcPost/share/InMail urn). */
export async function createCreativeByReference(
  client: LinkedInClient,
  opts: {
    accountId: string;
    campaignId: string;
    contentReference: string; // urn:li:ugcPost:... | urn:li:share:...
    intendedStatus?: "DRAFT" | "ACTIVE" | "PAUSED";
    name?: string;
  },
): Promise<CreatedEntity> {
  const res = await client.request({
    method: "POST",
    path: `/adAccounts/${opts.accountId}/creatives`,
    body: {
      campaign: campaignUrn(opts.campaignId),
      intendedStatus: opts.intendedStatus ?? "DRAFT",
      content: { reference: opts.contentReference },
      ...(opts.name ? { name: opts.name } : {}),
    },
  });
  if (!res.restliId) throw new Error("Creative created but no id returned");
  return { id: res.restliId };
}

/**
 * Create a single-image Sponsored Content creative inline (post + creative in one
 * call). The post is created as Direct Sponsored Content owned by the org.
 */
export async function createInlineImageCreative(
  client: LinkedInClient,
  opts: {
    accountId: string;
    campaignId: string;
    organizationUrn: string;
    commentary: string;
    imageUrn: string;
    /** Rendered as the ad headline under the image (content.media.title). */
    headline?: string;
    /** Click-through destination (contentLandingPage on the DSC post). */
    clickUri?: string;
    /** Call-to-action button label, e.g. LEARN_MORE. Only applied when clickUri is set. */
    callToAction?: string;
    altText?: string;
    intendedStatus?: "DRAFT" | "ACTIVE" | "PAUSED";
    name?: string;
  },
): Promise<CreatedEntity> {
  const res = await client.request({
    method: "POST",
    path: `/adAccounts/${opts.accountId}/creatives`,
    query: { action: "createInline" },
    body: {
      creative: {
        campaign: campaignUrn(opts.campaignId),
        intendedStatus: opts.intendedStatus ?? "DRAFT",
        inlineContent: {
          post: {
            adContext: {
              dscAdAccount: sponsoredAccountUrn(opts.accountId),
              dscStatus: "ACTIVE",
              ...(opts.name ? { dscName: opts.name } : {}),
            },
            author: opts.organizationUrn,
            commentary: opts.commentary,
            visibility: "PUBLIC",
            distribution: { feedDistribution: "NONE" },
            lifecycleState: "PUBLISHED",
            isReshareDisabledByAuthor: false,
            ...(opts.clickUri
              ? {
                  contentLandingPage: opts.clickUri,
                  contentCallToActionLabel: opts.callToAction ?? "LEARN_MORE",
                }
              : {}),
            // With a click-through URL, Campaign Manager stores single-image ads as
            // article content (title/thumbnail/source) — its ad editor reads the
            // Destination URL from content.article.source and won't hydrate the form
            // from contentLandingPage alone. Without a URL, plain media content.
            content: opts.clickUri
              ? {
                  article: {
                    title: opts.headline ?? "",
                    thumbnail: opts.imageUrn,
                    source: opts.clickUri,
                  },
                }
              : {
                  media: {
                    id: opts.imageUrn,
                    ...(opts.headline ? { title: opts.headline } : {}),
                    ...(opts.altText ? { altText: opts.altText } : {}),
                  },
                },
          },
        },
        ...(opts.name ? { name: opts.name } : {}),
      },
    },
  });
  const inlineId = res.restliId ?? (res.data as { value?: { creative?: string } } | undefined)?.value?.creative;
  if (!inlineId) throw new Error("Creative created but no id returned");
  return { id: inlineId };
}

/**
 * Legacy Text Ad creative (uses the `variables` shape per Campaign Management
 * getting-started). Text ads are a distinct campaign type from Sponsored Content.
 */
export async function createTextAdCreative(
  client: LinkedInClient,
  opts: {
    accountId: string;
    campaignId: string;
    title: string;
    text: string;
    clickUri: string;
    status?: "DRAFT" | "ACTIVE" | "PAUSED";
  },
): Promise<CreatedEntity> {
  const res = await client.request({
    method: "POST",
    path: `/adAccounts/${opts.accountId}/creatives`,
    body: {
      campaign: campaignUrn(opts.campaignId),
      intendedStatus: opts.status ?? "DRAFT",
      content: {
        textAd: { headline: opts.title, description: opts.text, landingPage: opts.clickUri },
      },
    },
  });
  if (!res.restliId) throw new Error("Creative created but no id returned");
  return { id: res.restliId };
}

/**
 * Set a creative's intendedStatus: POST to the creative with
 * `X-RestLi-Method: PARTIAL_UPDATE` and a `patch.$set`; LinkedIn answers 204.
 */
export async function setCreativeStatus(
  client: LinkedInClient,
  accountId: string,
  creativeId: string,
  intendedStatus: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED",
): Promise<void> {
  // Accept a numeric id or a full URN; the URN's colons must be URL-encoded
  // or LinkedIn rejects the path with "Syntax exception in path variables".
  const urn = creativeId.startsWith("urn:") ? creativeId : `urn:li:sponsoredCreative:${creativeId}`;
  await client.request({
    method: "POST",
    path: `/adAccounts/${accountId}/creatives/${encodeURIComponent(urn)}`,
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: { patch: { $set: { intendedStatus } } },
  });
}

export interface CreativeSummary {
  id: string;
  name: string;
  intendedStatus: string;
  campaignId: string;
  postUrn?: string;
}

/** List creatives (ads) in a campaign, drafts included. */
export async function listCreatives(
  client: LinkedInClient,
  accountId: string,
  campaignId: string,
): Promise<CreativeSummary[]> {
  const res = await client.request({
    path: `/adAccounts/${accountId}/creatives`,
    rawQuery: `q=criteria&campaigns=List(${encodeURIComponent(campaignUrn(campaignId))})&pageSize=100`,
  });
  const els = (res.data as { elements?: Record<string, unknown>[] }).elements ?? [];
  return els.map((e) => ({
    id: String(e.id),
    name: String(e.name ?? ""),
    intendedStatus: String(e.intendedStatus ?? ""),
    campaignId: String(e.campaign ?? "").replace("urn:li:sponsoredCampaign:", ""),
    postUrn: (e.content as { reference?: string } | undefined)?.reference,
  }));
}

export async function getCreative(client: LinkedInClient, accountId: string, creativeUrn: string) {
  const res = await client.request({
    path: `/adAccounts/${accountId}/creatives/${encodeURIComponent(creativeUrn)}`,
  });
  return res.data as Record<string, unknown>;
}

export async function deleteCreative(
  client: LinkedInClient,
  accountId: string,
  creativeUrn: string,
): Promise<void> {
  await client.request({
    method: "DELETE",
    path: `/adAccounts/${accountId}/creatives/${encodeURIComponent(creativeUrn)}`,
  });
}
