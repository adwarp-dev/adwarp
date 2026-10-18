import {
  oauthLogin,
  createOauthTokenProvider,
  type OauthProvider,
  type TokenProvider,
} from "@adwarp/shared";
import {
  type AppConfig,
  type StoredCredentials,
  type CredentialStore,
  OAUTH_REDIRECT_URI,
  loadConfig,
  FileCredentialStore,
  resolveCredentialStore,
} from "./config.js";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

/**
 * Scopes for ad management. r_ads_reporting is reporting, rw_conversions is the
 * Conversions API, and w_organization_social lets image ads create the Direct
 * Sponsored Content post owned by your LinkedIn Page. Adding a scope later
 * requires a fresh `auth login`: refreshing a token keeps only the old scopes.
 */
export const DEFAULT_SCOPES = ["rw_ads", "r_ads_reporting", "rw_conversions", "w_organization_social"];

const CALLBACK_PORT = 53682;

const RELOGIN_HINT = "Run `adwarp auth login` (local) or set ADWARP_LINKEDIN_REFRESH_TOKEN (hosted).";

/** The shared OAuth descriptor for LinkedIn, built from the loaded app config. */
function linkedinProvider(config: AppConfig, scopes: string[] = DEFAULT_SCOPES): OauthProvider {
  return {
    name: "LinkedIn",
    authUrl: AUTH_URL,
    tokenUrl: TOKEN_URL,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: OAUTH_REDIRECT_URI,
    callbackPort: CALLBACK_PORT,
    scopes,
  };
}

/**
 * Interactive 3-legged OAuth: opens the consent screen, captures the code,
 * exchanges it, and persists tokens to credentials.json in the Adwarp folder. Returns the
 * granted credentials (including the scopes actually granted).
 */
export async function login(scopes: string[] = DEFAULT_SCOPES): Promise<StoredCredentials> {
  const config = await loadConfig();
  // Login is always interactive/local, so persist to the file store.
  return oauthLogin(linkedinProvider(config, scopes), new FileCredentialStore());
}

/**
 * Returns the environment variables needed to run the hosted MCP server, read
 * from the local login. Paste these into Vercel project settings. The refresh
 * token is long-lived (~365d); the server derives access tokens from it.
 */
export async function exportHostedEnv(): Promise<Record<string, string>> {
  const config = await loadConfig();
  const creds = await new FileCredentialStore().load();
  if (!creds?.refreshToken) {
    throw new Error("No refresh token found. Run `adwarp auth login` first.");
  }
  return {
    ADWARP_LINKEDIN_CLIENT_ID: config.clientId,
    ADWARP_LINKEDIN_CLIENT_SECRET: config.clientSecret,
    ADWARP_LINKEDIN_VERSION: config.linkedinVersion ?? "",
    ADWARP_LINKEDIN_REFRESH_TOKEN: creds.refreshToken,
  };
}

/**
 * Returns a TokenProvider for the HTTP client: loads stored creds (from env or
 * file), refreshes them when near expiry, and surfaces a clear error if
 * re-login is required.
 */
export async function createTokenProvider(store: CredentialStore = resolveCredentialStore()): Promise<TokenProvider> {
  const config = await loadConfig();
  return createOauthTokenProvider({
    provider: linkedinProvider(config),
    store,
    reloginHint: RELOGIN_HINT,
  });
}
