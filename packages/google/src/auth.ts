import {
  oauthLogin,
  createOauthTokenProvider,
  FileCredentialStore,
  type CredentialStore,
  type OauthProvider,
  type StoredCredentials,
  type TokenProvider,
} from "@adwarp/shared";
import {
  loadGoogleConfig,
  resolveGoogleCredentialStore,
  googleCredentialsPath,
  OAUTH_REDIRECT_URI,
  OAUTH_CALLBACK_PORT,
  type GoogleAdsConfig,
} from "./config.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** The single scope the Google Ads API uses. There is no finer-grained split. */
export const ADWORDS_SCOPE = "https://www.googleapis.com/auth/adwords";

const RELOGIN_HINT = "Run `adwarp google auth login`.";

/**
 * Google's OAuth descriptor.
 *
 * `access_type=offline` plus `prompt=consent` are both mandatory: without them
 * Google returns a refresh token on the very first authorization only, and
 * every re-authorization after that comes back with none, which strands the
 * CLI an hour later when the access token expires.
 */
function googleProvider(config: GoogleAdsConfig, scopes: string[] = [ADWORDS_SCOPE]): OauthProvider {
  return {
    name: "Google Ads",
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: OAUTH_REDIRECT_URI,
    callbackPort: OAUTH_CALLBACK_PORT,
    scopes,
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  };
}

/**
 * Interactive OAuth against the Google Cloud project's client. Persists tokens
 * to google-credentials.json in the Adwarp folder.
 *
 * If the consent screen is still in "Testing", Google issues refresh tokens
 * that stop working after 7 days. Set the app to Internal (any Workspace org
 * qualifies) or publish it before relying on this.
 */
export async function googleLogin(scopes: string[] = [ADWORDS_SCOPE]): Promise<StoredCredentials> {
  const config = await loadGoogleConfig();
  return oauthLogin(googleProvider(config, scopes), new FileCredentialStore(googleCredentialsPath));
}

/** Auto-refreshing token provider for the Google Ads HTTP client. */
export async function createGoogleTokenProvider(
  store: CredentialStore = resolveGoogleCredentialStore(),
): Promise<TokenProvider> {
  const config = await loadGoogleConfig();
  return createOauthTokenProvider({ provider: googleProvider(config), store, reloginHint: RELOGIN_HINT });
}
