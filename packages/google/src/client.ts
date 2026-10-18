import { displayPath, env, type TokenProvider } from "@adwarp/shared";
import { googleConfigPath, loadGoogleConfig } from "./config.js";
import { createGoogleTokenProvider } from "./auth.js";
import { GoogleAdsClient, type GoogleMutationHook } from "./http.js";
import { recordGoogleMutation } from "./changelog.js";

export interface GoogleAds {
  client: GoogleAdsClient;
  getToken: TokenProvider;
}

/**
 * Builds a ready-to-use Google Ads client: loads config, wires the
 * auto-refreshing token provider, and journals every write. Throws a clear
 * error if not yet authenticated.
 */
export async function createGoogleAds(): Promise<GoogleAds> {
  const config = await loadGoogleConfig();
  if (!config.developerToken) {
    throw new Error(
      `No developer token. Add "developerToken" to ${displayPath(googleConfigPath)} (get one from your Google Ads manager account at ads.google.com/aw/apicenter) or set ADWARP_GOOGLE_DEVELOPER_TOKEN.`,
    );
  }
  const getToken = await createGoogleTokenProvider();
  // Disabled on hosted deploys (read-only filesystem) and whenever ADWARP_NO_CHANGELOG is set.
  const journaling = !env("ADWARP_GOOGLE_REFRESH_TOKEN") && !env("ADWARP_NO_CHANGELOG");
  const onMutation: GoogleMutationHook | undefined = journaling ? recordGoogleMutation : undefined;
  return { client: new GoogleAdsClient(config, getToken, onMutation), getToken };
}
