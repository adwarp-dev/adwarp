import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  ADWARP_DIR,
  displayPath,
  env,
  EnvCredentialStore,
  FileCredentialStore,
  type CredentialStore,
} from "@adwarp/shared";

/**
 * Google Ads config lives alongside LinkedIn's in the Adwarp folder rather than in
 * a directory of its own: one place holds every credential this tool stores, and
 * the change journal at the root already spans both platforms.
 */
const CONFIG_PATH = join(ADWARP_DIR, "google.json");
const CREDENTIALS_PATH = join(ADWARP_DIR, "google-credentials.json");

/**
 * Google Ads API version. Pinned deliberately: major versions carry breaking
 * changes (v24 renamed campaign.start_date to start_date_time) and each is
 * supported for roughly a year, so bumping is a decision, not a default.
 */
export const DEFAULT_API_VERSION = "v25";

/** OAuth callback for the local login server. A Google "Desktop app" client accepts any localhost port. */
export const OAUTH_REDIRECT_URI = "http://localhost:53683/callback";
export const OAUTH_CALLBACK_PORT = 53683;

export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  /**
   * From the manager account's API Center. Required on every call unless the
   * Cloud-managed access pilot is enabled for this org.
   */
  developerToken: string;
  /**
   * The manager (MCC) customer id, digits only. Sent as `login-customer-id`.
   * Only needed when the OAuth user reaches the target account through a
   * manager rather than owning it directly.
   */
  loginCustomerId?: string;
  /** Customer id used when a command or brief omits one. Digits only. */
  defaultCustomerId?: string;
  /** Falls back to DEFAULT_API_VERSION. */
  apiVersion?: string;
  /**
   * Conversion action names attached to new campaigns when a brief names none.
   * Mirrors LinkedIn's defaultConversionNames.
   */
  defaultConversionActionNames?: string[];
}

/** Strip formatting from a customer id: Google rejects "123-456-7890". */
export const normalizeCustomerId = (id: string): string => id.replace(/\D/g, "");

/**
 * Loads Google Ads config. Environment variables first (hosted / CI), then
 * google.json in the Adwarp folder (local CLI).
 */
export async function loadGoogleConfig(): Promise<GoogleAdsConfig> {
  const clientId = env("ADWARP_GOOGLE_CLIENT_ID");
  const clientSecret = env("ADWARP_GOOGLE_CLIENT_SECRET");
  if (clientId && clientSecret) {
    return {
      clientId,
      clientSecret,
      developerToken: env("ADWARP_GOOGLE_DEVELOPER_TOKEN") ?? "",
      loginCustomerId: env("ADWARP_GOOGLE_LOGIN_CUSTOMER_ID"),
      defaultCustomerId: env("ADWARP_GOOGLE_DEFAULT_CUSTOMER_ID"),
      apiVersion: env("ADWARP_GOOGLE_API_VERSION"),
    };
  }
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No Google Ads credentials. Create ${displayPath(CONFIG_PATH)} with { "clientId", "clientSecret", "developerToken", "loginCustomerId", "defaultCustomerId" }, or set ADWARP_GOOGLE_CLIENT_ID / ADWARP_GOOGLE_CLIENT_SECRET / ADWARP_GOOGLE_DEVELOPER_TOKEN.`,
    );
  }
  const parsed = JSON.parse(raw) as GoogleAdsConfig;
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error(`${displayPath(CONFIG_PATH)} must include clientId and clientSecret.`);
  }
  return parsed;
}

export function apiVersion(config: GoogleAdsConfig): string {
  return config.apiVersion ?? DEFAULT_API_VERSION;
}

/** Resolve the customer id to act on, or throw if neither given nor configured. */
export async function requireCustomerId(customerId?: string): Promise<string> {
  if (customerId) return normalizeCustomerId(customerId);
  const { defaultCustomerId } = await loadGoogleConfig();
  if (!defaultCustomerId) {
    throw new Error(`No customerId provided and no defaultCustomerId in ${displayPath(CONFIG_PATH)}.`);
  }
  return normalizeCustomerId(defaultCustomerId);
}

/** Effective list of conversion action names to attach to new campaigns. */
export function resolveDefaultConversionActionNames(config: GoogleAdsConfig): string[] {
  return config.defaultConversionActionNames ?? [];
}

/** Local token file, or an env-seeded memory store on a hosted deploy. */
export function resolveGoogleCredentialStore(): CredentialStore {
  const refreshToken = env("ADWARP_GOOGLE_REFRESH_TOKEN");
  if (refreshToken) {
    return new EnvCredentialStore(refreshToken);
  }
  return new FileCredentialStore(CREDENTIALS_PATH);
}

export const googleCredentialsPath = CREDENTIALS_PATH;
export const googleConfigPath = CONFIG_PATH;
