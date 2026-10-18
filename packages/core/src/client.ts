import { env } from "@adwarp/shared";
import { activeRequestCredentials, loadConfig } from "./config.js";
import { LinkedInClient, type MutationHook, type TokenProvider } from "./http.js";
import { createTokenProvider } from "./auth.js";
import { recordMutation } from "./changelog.js";

export interface LinkedInAds {
  client: LinkedInClient;
  /** Returns a valid bearer token (used for image binary uploads). */
  getToken: TokenProvider;
}

/**
 * Builds a ready-to-use LinkedIn client: loads app config, wires the
 * auto-refreshing token provider. Throws a clear error if not yet authenticated.
 */
export async function createLinkedInAds(): Promise<LinkedInAds> {
  const config = await loadConfig();
  const getToken = await createTokenProvider();
  // Auto-journal every change to the local changelog for later lift comparison.
  // Disabled on hosted deploys (read-only FS: ADWARP_LINKEDIN_REFRESH_TOKEN env or
  // per-request header credentials) and whenever ADWARP_NO_CHANGELOG is set.
  const journaling =
    !activeRequestCredentials() && !env("ADWARP_LINKEDIN_REFRESH_TOKEN") && !env("ADWARP_NO_CHANGELOG");
  const onMutation: MutationHook | undefined = journaling ? recordMutation : undefined;
  const client = new LinkedInClient(config, getToken, onMutation);
  return { client, getToken };
}
