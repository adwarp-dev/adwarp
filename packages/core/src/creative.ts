import { LinkedInApiError, type LinkedInClient, type TokenProvider } from "./http.js";
import type { AdStatus, AdUpdateInput, SponsoredImageCreativeInput } from "./schemas.js";
import { uploadImage } from "./resources/images.js";
import { createInlineImageCreative, deleteCreative, getCreative, setCreativeStatus } from "./resources/creatives.js";
import { creativeUrn } from "./urns.js";

export interface DraftCreativeResult {
  creativeId: string;
  status: string;
  imageUrn?: string;
  /** Set when no image was provided and the creative was intentionally not created. */
  pendingImage?: boolean;
  note?: string;
}

/**
 * High-level path for a single-image Sponsored Content draft. If an image path is
 * given, it's uploaded first and the creative is created inline as a DRAFT. If no
 * image is given, nothing is created — the campaign is left ready for Stan to add
 * creative later (the "I'll drop in the picture myself" workflow).
 */
export async function createSponsoredImageDraft(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: SponsoredImageCreativeInput,
): Promise<DraftCreativeResult> {
  if (!input.imagePath) {
    return {
      creativeId: "",
      status: input.status,
      pendingImage: true,
      note: "No image supplied. The campaign is ready; add the creative with an image when available.",
    };
  }

  const token = await getToken();
  const imageUrn = await uploadImage(client, {
    imagePath: input.imagePath,
    ownerUrn: input.organizationUrn,
    token,
  });

  // createInline intermittently 404s ("Could not find entity") right after an
  // image upload — asset propagation lag on LinkedIn's side. A short backoff
  // and retry of the identical request succeeds.
  const created = await withTransient404Retry(() =>
    createInlineImageCreative(client, {
      accountId: input.accountId,
      campaignId: input.campaignId,
      organizationUrn: input.organizationUrn,
      commentary: input.commentary,
      imageUrn,
      headline: input.headline,
      clickUri: input.clickUri,
      callToAction: input.callToAction,
      altText: input.headline,
      intendedStatus: input.status,
      name: input.name,
    }),
  );

  return { creativeId: created.id, status: input.status, imageUrn };
}

async function withTransient404Retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!(e instanceof LinkedInApiError) || e.status !== 404 || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastError;
}

export interface DeletedAdResult {
  creativeId: string;
  postUrn?: string;
  postDeleted: boolean;
}

/**
 * Delete an ad: the creative and the Direct Sponsored Content post behind it.
 * Post deletion is best-effort — a creative whose post is already gone still
 * gets cleaned up.
 */
export async function deleteAd(
  client: LinkedInClient,
  accountId: string,
  creativeId: string,
): Promise<DeletedAdResult> {
  const urn = creativeId.startsWith("urn:") ? creativeId : creativeUrn(creativeId);
  const creative = await getCreative(client, accountId, urn);
  const postUrn = (creative.content as { reference?: string } | undefined)?.reference;
  await deleteCreative(client, accountId, urn);
  let postDeleted = false;
  if (postUrn) {
    try {
      await client.request({ method: "DELETE", path: `/posts/${encodeURIComponent(postUrn)}` });
      postDeleted = true;
    } catch {
      // best-effort: the creative is gone either way
    }
  }
  return { creativeId: urn, postUrn, postDeleted };
}

export interface AdUpdateResult {
  /** The ad's full urn:li:sponsoredCreative URN. */
  creativeId: string;
  intendedStatus: AdStatus;
  /** True when dryRun: the patch was built and returned but NOT sent. */
  dryRun?: boolean;
  /** The PARTIAL_UPDATE $set payload (returned on a dry run). */
  patch?: Record<string, unknown>;
}

/**
 * Pause, resume, or archive a single ad by patching the creative's
 * `intendedStatus`. A creative's status is independent of its campaign's, but a
 * campaign that is not ACTIVE still keeps an ACTIVE ad from serving. LinkedIn
 * refuses (400) to pause a creative that is still in review. With dryRun the
 * patch is returned but not sent.
 */
export async function updateAd(
  client: LinkedInClient,
  input: AdUpdateInput & { accountId: string },
): Promise<AdUpdateResult> {
  const urn = input.creativeId.startsWith("urn:") ? input.creativeId : creativeUrn(input.creativeId);
  const patch = { intendedStatus: input.status };
  if (input.dryRun) return { creativeId: urn, intendedStatus: input.status, dryRun: true, patch };
  await setCreativeStatus(client, input.accountId, urn, input.status);
  return { creativeId: urn, intendedStatus: input.status };
}
