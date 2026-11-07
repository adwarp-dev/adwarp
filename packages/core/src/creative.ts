import { LinkedInApiError, type LinkedInClient, type TokenProvider } from "./http.js";
import type { AdStatus, AdUpdateInput, PostAdCreativeInput, SponsoredImageCreativeInput } from "./schemas.js";
import { uploadImage } from "./resources/images.js";
import {
  createCreativeByReference,
  createInlineImageCreative,
  deleteCreative,
  getCreative,
  setCreativeStatus,
} from "./resources/creatives.js";
import { creativeUrn, sponsoredAccountUrn } from "./urns.js";

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

/** Why an activity URN is refused, and where to find the post URN instead. */
const ACTIVITY_URN_HELP =
  "LinkedIn's Marketing API has no documented way to turn an activity URN into the urn:li:ugcPost: or urn:li:share: URN an ad references. " +
  "To get the post URN, open the post's ... menu, choose Embed this post, and copy the urn:li:ugcPost: or urn:li:share: value from the embed code (or pass the embed URL as is). " +
  "Campaign Manager also finds a member's post by URL when you browse existing content in the ad set.";

/** Percent-decode a pasted URL, twice for double-encoded links. Malformed escapes are left as they are. */
function decodeLoosely(text: string): string {
  let out = text;
  for (let i = 0; i < 2 && out.includes("%"); i++) {
    try {
      out = decodeURIComponent(out);
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Normalize what a user pastes for a post to the URN a creative references:
 * a bare `urn:li:ugcPost:` / `urn:li:share:` URN, or a LinkedIn URL that
 * contains one (feed/update and embed links, encoded or not). Activity URNs,
 * and /posts/ links that carry only an activity id, are refused with
 * directions to the post URN.
 */
export function parsePostUrn(input: string): string {
  const text = decodeLoosely(input.trim());
  const post = text.match(/urn:li:(ugcPost|share):(\d+)/i);
  if (post) return `urn:li:${post[1]!.toLowerCase() === "share" ? "share" : "ugcPost"}:${post[2]}`;
  const activity = text.match(/urn:li:activity:(\d+)/i) ?? text.match(/activity-(\d+)/i);
  if (activity) {
    throw new Error(`${input.trim()} points at activity ${activity[1]}, not a post URN. ${ACTIVITY_URN_HELP}`);
  }
  throw new Error(
    `"${input.trim()}" has no LinkedIn post URN in it. Pass a urn:li:ugcPost: or urn:li:share: URN, or a LinkedIn URL that contains one.`,
  );
}

export interface PostAdResult {
  creativeId: string;
  /** The urn:li:ugcPost: or urn:li:share: URN the ad sponsors. */
  postUrn: string;
  status: string;
}

/**
 * Sponsor an existing post as an ad: a creative whose content references the
 * post, created DRAFT unless the input says otherwise. For a member's post (a
 * thought leader ad) the member has to approve the sponsorship in LinkedIn
 * first; the API cannot send or approve that request.
 */
export async function createPostAd(
  client: LinkedInClient,
  input: PostAdCreativeInput & { accountId: string },
): Promise<PostAdResult> {
  const postUrn = parsePostUrn(input.postUrn);
  const created = await createCreativeByReference(client, {
    accountId: input.accountId,
    campaignId: input.campaignId,
    contentReference: postUrn,
    intendedStatus: input.status,
    name: input.name,
  });
  return { creativeId: created.id, postUrn, status: input.status };
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
  /** Why the post was left in place, when it was not deleted on purpose. */
  postNote?: string;
}

/**
 * True only when the post is Direct Sponsored Content made by this ad account,
 * i.e. a dark post that exists for the ad. A member's post (thought leader ad)
 * or an organic Page post is not, and neither is a post that cannot be read.
 */
async function isOwnDscPost(client: LinkedInClient, accountId: string, postUrn: string): Promise<boolean> {
  try {
    const res = await client.request({ path: `/posts/${encodeURIComponent(postUrn)}` });
    const ctx = (res.data as { adContext?: { isDsc?: boolean; dscAdAccount?: string } } | undefined)?.adContext;
    return ctx?.isDsc === true && ctx.dscAdAccount === sponsoredAccountUrn(accountId);
  } catch {
    return false;
  }
}

/**
 * Delete an ad: the creative, and the Direct Sponsored Content post behind it
 * when this ad account made that post. A post the ad only references, such as
 * a member's post or an organic Page post, is never deleted. Post deletion is
 * best-effort: a creative whose post is already gone still gets cleaned up.
 */
export async function deleteAd(
  client: LinkedInClient,
  accountId: string,
  creativeId: string,
): Promise<DeletedAdResult> {
  const urn = creativeId.startsWith("urn:") ? creativeId : creativeUrn(creativeId);
  const creative = await getCreative(client, accountId, urn);
  const postUrn = (creative.content as { reference?: string } | undefined)?.reference;
  // Anything not provably this account's dark post is kept, so a failed read keeps the post.
  const ownDsc = postUrn ? await isOwnDscPost(client, accountId, postUrn) : false;
  await deleteCreative(client, accountId, urn);
  if (!postUrn) return { creativeId: urn, postDeleted: false };
  if (!ownDsc) {
    return {
      creativeId: urn,
      postUrn,
      postDeleted: false,
      postNote: "Left in place: it is not a Direct Sponsored Content post from this ad account (for example a member's post or an organic Page post).",
    };
  }
  let postDeleted = false;
  try {
    await client.request({ method: "DELETE", path: `/posts/${encodeURIComponent(postUrn)}` });
    postDeleted = true;
  } catch {
    // best-effort: the creative is gone either way
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
