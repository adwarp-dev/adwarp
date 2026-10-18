import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  ADWARP_DIR,
  displayPath,
  env,
  EnvCredentialStore,
  FileCredentialStore as SharedFileCredentialStore,
  type CredentialStore,
  type StoredCredentials,
} from "@adwarp/shared";

// Re-exported so every existing `import { ... } from "@adwarp/core"` keeps working
// now that the credential layer lives in the shared package.
export { ADWARP_DIR, EnvCredentialStore };
export type { CredentialStore, StoredCredentials };

const CONFIG_PATH = join(ADWARP_DIR, "config.json");
const CREDENTIALS_PATH = join(ADWARP_DIR, "credentials.json");

/** Default LinkedIn API version (YYYYMM). Pinned; bump deliberately. */
export const DEFAULT_LINKEDIN_VERSION = "202605";

/** OAuth callback the local login server listens on. Must match the app's redirect URL. */
export const OAUTH_REDIRECT_URI = "http://localhost:53682/callback";

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  /** YYYYMM. Falls back to DEFAULT_LINKEDIN_VERSION. */
  linkedinVersion?: string;
  /** Numeric ad account id used when a command/brief omits one. */
  defaultAccountId?: string;
  /** Conversion name auto-selected for new campaigns when none is specified. */
  defaultConversionName?: string;
  /**
   * Conversion names auto-selected for new campaigns when none is specified.
   * Takes precedence over defaultConversionName; every listed conversion is
   * attached. Use resolveDefaultConversionNames() to read the effective list.
   */
  defaultConversionNames?: string[];
}

/**
 * Effective list of default conversion names to attach to new campaigns:
 * defaultConversionNames if set, else the single defaultConversionName, else [].
 */
export function resolveDefaultConversionNames(config: AppConfig): string[] {
  if (config.defaultConversionNames?.length) return config.defaultConversionNames;
  return config.defaultConversionName ? [config.defaultConversionName] : [];
}

/**
 * Per-request credentials for the hosted multi-tenant path: a caller brings
 * their own LinkedIn app + refresh token in request headers, and the HTTP
 * handler runs the request inside `withRequestCredentials`. Everything below
 * (loadConfig, resolveCredentialStore) checks this context first, so the same
 * tool code serves the env-configured tenant and header-credentialed callers.
 */
export interface RequestCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  linkedinVersion?: string;
  defaultAccountId?: string;
}

const requestCredentials = new AsyncLocalStorage<RequestCredentials>();

/** Runs fn with the given caller credentials active for every nested call. */
export function withRequestCredentials<T>(creds: RequestCredentials, fn: () => T): T {
  return requestCredentials.run(creds, fn);
}

/** The caller credentials active for the current request, if any. */
export function activeRequestCredentials(): RequestCredentials | undefined {
  return requestCredentials.getStore();
}

/**
 * Request headers that carry a caller's own LinkedIn credentials on the hosted
 * endpoint. Each field lists its current name first, then the X-Liads-* name it
 * had before the Adwarp rename, which keeps working for existing connections.
 */
export const CREDENTIAL_HEADERS = {
  clientId: ["x-adwarp-linkedin-client-id", "x-liads-client-id"],
  clientSecret: ["x-adwarp-linkedin-client-secret", "x-liads-client-secret"],
  refreshToken: ["x-adwarp-linkedin-refresh-token", "x-liads-refresh-token"],
  defaultAccountId: ["x-adwarp-linkedin-account-id", "x-liads-account-id"],
  linkedinVersion: ["x-adwarp-linkedin-version", "x-liads-linkedin-version"],
} as const;

/** Caller credentials from request headers, when the 3 required ones are all present. */
export function requestCredentialsFromHeaders(headers: { get(name: string): string | null }): RequestCredentials | null {
  const read = (names: readonly string[]) => names.map((name) => headers.get(name)).find((value) => value) ?? undefined;
  const clientId = read(CREDENTIAL_HEADERS.clientId);
  const clientSecret = read(CREDENTIAL_HEADERS.clientSecret);
  const refreshToken = read(CREDENTIAL_HEADERS.refreshToken);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    defaultAccountId: read(CREDENTIAL_HEADERS.defaultAccountId),
    linkedinVersion: read(CREDENTIAL_HEADERS.linkedinVersion),
  };
}

/**
 * Loads app config. Prefers per-request credentials (hosted multi-tenant),
 * then environment variables (hosted / Vercel single tenant), then
 * config.json in the Adwarp folder (local CLI and self-host).
 */
export async function loadConfig(): Promise<AppConfig> {
  const reqCreds = activeRequestCredentials();
  if (reqCreds) {
    return {
      clientId: reqCreds.clientId,
      clientSecret: reqCreds.clientSecret,
      linkedinVersion: reqCreds.linkedinVersion,
      defaultAccountId: reqCreds.defaultAccountId,
    };
  }
  const clientId = env("ADWARP_LINKEDIN_CLIENT_ID");
  const clientSecret = env("ADWARP_LINKEDIN_CLIENT_SECRET");
  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      linkedinVersion: env("ADWARP_LINKEDIN_VERSION"),
      defaultAccountId: env("ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID"),
    };
  }
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No credentials. Set ADWARP_LINKEDIN_CLIENT_ID/ADWARP_LINKEDIN_CLIENT_SECRET env vars, or create ${displayPath(CONFIG_PATH)} with { "clientId", "clientSecret", "linkedinVersion" }.`,
    );
  }
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error(`${displayPath(CONFIG_PATH)} must include clientId and clientSecret.`);
  }
  return parsed;
}

export function linkedinVersion(config: AppConfig): string {
  return config.linkedinVersion ?? DEFAULT_LINKEDIN_VERSION;
}

/** Resolves the default ad account id from config, or throws if none is set. */
export async function requireDefaultAccountId(): Promise<string> {
  const { defaultAccountId } = await loadConfig();
  if (!defaultAccountId) {
    throw new Error("No account id provided and no defaultAccountId in config.");
  }
  return defaultAccountId;
}

/** LinkedIn's local token file, credentials.json in the Adwarp folder (mode 0600). */
export class FileCredentialStore extends SharedFileCredentialStore {
  constructor() {
    super(CREDENTIALS_PATH);
  }
}

/**
 * Store for header-credentialed callers. Access tokens derived from a caller's
 * refresh token are cached in module memory (keyed by that refresh token) so
 * repeat calls within a warm instance don't re-hit LinkedIn's token endpoint.
 * Nothing is ever written to disk.
 */
const requestTokenCache = new Map<string, StoredCredentials>();
const REQUEST_TOKEN_CACHE_MAX = 100;

export class RequestCredentialStore implements CredentialStore {
  constructor(private readonly refreshToken: string) {}
  async load(): Promise<StoredCredentials | null> {
    return (
      requestTokenCache.get(this.refreshToken) ?? {
        accessToken: "",
        refreshToken: this.refreshToken,
        expiresAt: 0,
      }
    );
  }
  async save(creds: StoredCredentials): Promise<void> {
    if (requestTokenCache.size >= REQUEST_TOKEN_CACHE_MAX) {
      const oldest = requestTokenCache.keys().next().value;
      if (oldest !== undefined) requestTokenCache.delete(oldest);
    }
    requestTokenCache.set(this.refreshToken, creds);
  }
}

/**
 * Picks the store matching where credentials came from: per-request headers,
 * then the env refresh token, else the local file.
 */
export function resolveCredentialStore(): CredentialStore {
  const reqCreds = activeRequestCredentials();
  if (reqCreds) {
    return new RequestCredentialStore(reqCreds.refreshToken);
  }
  const refreshToken = env("ADWARP_LINKEDIN_REFRESH_TOKEN");
  if (refreshToken) {
    return new EnvCredentialStore(refreshToken);
  }
  return new FileCredentialStore();
}
