/**
 * Credentials for the public ad libraries. They come only from ADWARP_LIBRARY_* environment variables.
 *
 * This module deliberately never reads ADWARP_LINKEDIN_*, ADWARP_GOOGLE_*, the LIADS_* or GADS_* names, ~/.adwarp
 * or ~/.liads. Those hold the app that manages someone's ad accounts, which is often their employer's app, and a
 * public-library collector for a separate project must not borrow it. A missing variable is an error that names
 * what to set, never a quiet fallback. test/credentials.test.mjs pins this.
 */

export type LibraryEnv = Record<string, string | undefined>;

export const LIBRARY_ENV_NAMES = {
  linkedin: [
    "ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN",
    "ADWARP_LIBRARY_LINKEDIN_CLIENT_ID",
    "ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET",
    "ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN",
    "ADWARP_LIBRARY_LINKEDIN_VERSION",
  ],
  meta: ["ADWARP_LIBRARY_META_ACCESS_TOKEN", "ADWARP_LIBRARY_META_API_VERSION"],
  tiktok: ["ADWARP_LIBRARY_TIKTOK_CLIENT_KEY", "ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET"],
  google: ["ADWARP_LIBRARY_GOOGLE_PROJECT", "ADWARP_LIBRARY_GOOGLE_ACCESS_TOKEN"],
} as const;

export class MissingLibraryCredentialsError extends Error {
  constructor(
    readonly platform: string,
    readonly variables: string[],
    hint: string,
  ) {
    super(`${platform} library credentials are missing. Set ${variables.join(", ")}. ${hint}`);
    this.name = "MissingLibraryCredentialsError";
  }
}

const read = (env: LibraryEnv, name: string): string | undefined => {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
};

export type LinkedInLibraryCredentials =
  | { kind: "access-token"; accessToken: string; version?: string }
  | { kind: "refresh-token"; clientId: string; clientSecret: string; refreshToken: string; version?: string };

export function linkedinLibraryCredentials(env: LibraryEnv = process.env): LinkedInLibraryCredentials {
  const version = read(env, "ADWARP_LIBRARY_LINKEDIN_VERSION");
  const accessToken = read(env, "ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN");
  if (accessToken) return { kind: "access-token", accessToken, ...(version ? { version } : {}) };
  const clientId = read(env, "ADWARP_LIBRARY_LINKEDIN_CLIENT_ID");
  const clientSecret = read(env, "ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET");
  const refreshToken = read(env, "ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN");
  if (clientId && clientSecret && refreshToken)
    return { kind: "refresh-token", clientId, clientSecret, refreshToken, ...(version ? { version } : {}) };
  throw new MissingLibraryCredentialsError(
    "LinkedIn",
    [
      "ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN",
      "or ADWARP_LIBRARY_LINKEDIN_CLIENT_ID, ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET and ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN",
    ],
    "Use a LinkedIn developer app that your own project's Page owns, with the LinkedIn Ad Library product approved. The credentials Adwarp uses for ad accounts are never read here.",
  );
}

export interface MetaLibraryCredentials {
  accessToken: string;
  version: string;
}

/** Graph API version. Meta keeps each version about 2 years; override when this one retires. */
export const DEFAULT_META_API_VERSION = "v25.0";

export function metaLibraryCredentials(env: LibraryEnv = process.env): MetaLibraryCredentials {
  const accessToken = read(env, "ADWARP_LIBRARY_META_ACCESS_TOKEN");
  if (!accessToken)
    throw new MissingLibraryCredentialsError(
      "Meta",
      ["ADWARP_LIBRARY_META_ACCESS_TOKEN"],
      "Create it with a Meta developer app that has finished identity confirmation and Ad Library API access.",
    );
  return { accessToken, version: read(env, "ADWARP_LIBRARY_META_API_VERSION") ?? DEFAULT_META_API_VERSION };
}

export interface TikTokLibraryCredentials {
  clientKey: string;
  clientSecret: string;
}

export function tiktokLibraryCredentials(env: LibraryEnv = process.env): TikTokLibraryCredentials {
  const clientKey = read(env, "ADWARP_LIBRARY_TIKTOK_CLIENT_KEY");
  const clientSecret = read(env, "ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET");
  if (!clientKey || !clientSecret)
    throw new MissingLibraryCredentialsError(
      "TikTok",
      ["ADWARP_LIBRARY_TIKTOK_CLIENT_KEY", "ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET"],
      "They come from an approved Commercial Content API research project on TikTok for Developers.",
    );
  return { clientKey, clientSecret };
}

export interface GoogleLibraryCredentials {
  project: string;
  accessToken: string;
}

export function googleLibraryCredentials(env: LibraryEnv = process.env): GoogleLibraryCredentials {
  const project = read(env, "ADWARP_LIBRARY_GOOGLE_PROJECT");
  const accessToken = read(env, "ADWARP_LIBRARY_GOOGLE_ACCESS_TOKEN");
  const missing = [
    ...(project ? [] : ["ADWARP_LIBRARY_GOOGLE_PROJECT"]),
    ...(accessToken ? [] : ["ADWARP_LIBRARY_GOOGLE_ACCESS_TOKEN"]),
  ];
  if (!project || !accessToken)
    throw new MissingLibraryCredentialsError(
      "Google",
      missing,
      "The project is a Google Cloud project you own that pays for BigQuery; the token can come from `gcloud auth print-access-token`.",
    );
  return { project, accessToken };
}
