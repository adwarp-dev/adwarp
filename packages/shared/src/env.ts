/**
 * Environment variables are named ADWARP_*. Each one still answers to the name
 * it had before the rename (LIADS_* for LinkedIn and shared settings, GADS_* for
 * Google), so existing deploys, scripts and cron jobs keep working. When both are
 * set, the new name wins. Empty values count as unset.
 */
export const LEGACY_ENV_NAMES = {
  ADWARP_LINKEDIN_CLIENT_ID: "LIADS_CLIENT_ID",
  ADWARP_LINKEDIN_CLIENT_SECRET: "LIADS_CLIENT_SECRET",
  ADWARP_LINKEDIN_REFRESH_TOKEN: "LIADS_REFRESH_TOKEN",
  ADWARP_LINKEDIN_VERSION: "LIADS_LINKEDIN_VERSION",
  ADWARP_LINKEDIN_DEFAULT_ACCOUNT_ID: "LIADS_DEFAULT_ACCOUNT_ID",
  ADWARP_GOOGLE_CLIENT_ID: "GADS_CLIENT_ID",
  ADWARP_GOOGLE_CLIENT_SECRET: "GADS_CLIENT_SECRET",
  ADWARP_GOOGLE_DEVELOPER_TOKEN: "GADS_DEVELOPER_TOKEN",
  ADWARP_GOOGLE_REFRESH_TOKEN: "GADS_REFRESH_TOKEN",
  ADWARP_GOOGLE_LOGIN_CUSTOMER_ID: "GADS_LOGIN_CUSTOMER_ID",
  ADWARP_GOOGLE_DEFAULT_CUSTOMER_ID: "GADS_DEFAULT_CUSTOMER_ID",
  ADWARP_GOOGLE_API_VERSION: "GADS_API_VERSION",
  ADWARP_CHANGELOG_PATH: "LIADS_CHANGELOG_PATH",
  ADWARP_NO_CHANGELOG: "LIADS_NO_CHANGELOG",
  ADWARP_CREATIVE_WORKER_URL: "LIADS_CREATIVE_WORKER_URL",
  ADWARP_CREATIVE_WORKER_TOKEN: "LIADS_CREATIVE_WORKER_TOKEN",
} as const;

/** Variables added after the rename. They have no older name to fall back to. */
export const ENV_NAMES_SINCE_RENAME = ["ADWARP_HUBSPOT_TOKEN"] as const;

export type EnvName = keyof typeof LEGACY_ENV_NAMES | (typeof ENV_NAMES_SINCE_RENAME)[number];

/** Reads an Adwarp environment variable, falling back to its pre-rename name. */
export function env(name: EnvName): string | undefined {
  const legacy = (LEGACY_ENV_NAMES as Record<string, string | undefined>)[name];
  return nonEmpty(process.env[name]) ?? (legacy ? nonEmpty(process.env[legacy]) : undefined);
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}
