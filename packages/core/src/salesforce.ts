import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LinkedInClient, TokenProvider } from "./http.js";
import { uploadAudienceFromEmails, type AudienceUploadResult } from "./audience.js";

const execFileAsync = promisify(execFile);

/**
 * Reads from Salesforce by shelling out to the already-authenticated `sf` CLI
 * (reuses existing auth — no new credentials). Phase 3 cross-referencing builds
 * on this. Read-only by design.
 */
export async function soql<T = Record<string, unknown>>(
  query: string,
  opts: { targetOrg?: string } = {},
): Promise<T[]> {
  const args = ["data", "query", "--json", "-q", query];
  if (opts.targetOrg) args.push("-o", opts.targetOrg);

  const { stdout } = await execFileAsync("sf", args, { maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout) as { status: number; result?: { records?: T[] }; message?: string };
  if (parsed.status !== 0) throw new Error(`sf query failed: ${parsed.message ?? "unknown error"}`);
  return parsed.result?.records ?? [];
}

/**
 * Phase 3 helper: pull email addresses for accounts flagged in Salesforce, to feed
 * a matched audience. Customize the SOQL to your org's schema (field and list names).
 */
export async function emailsForFlaggedAccounts(flagField: string): Promise<string[]> {
  const records = await soql<{ Email?: string }>(
    `SELECT Email FROM Contact WHERE Account.${flagField} = true AND Email != null`,
  );
  return records.map((r) => r.Email!).filter(Boolean);
}

/** Pull emails from a SOQL result, auto-detecting the email column. */
export async function emailsFromSoql(query: string, emailField?: string): Promise<string[]> {
  const rows = await soql<Record<string, unknown>>(query);
  const pick = (r: Record<string, unknown>) =>
    (emailField ? r[emailField] : undefined) ?? r.Email ?? r.email;
  return rows.map(pick).filter((e): e is string => typeof e === "string" && e.length > 0);
}

/**
 * Closes the loop: a Salesforce SOQL query (selecting an email column) becomes a
 * LinkedIn matched-audience DMP segment. The SOQL should return an `Email` field,
 * e.g. `SELECT Email FROM Contact WHERE Account.Target_List__c = true AND Email != null`.
 */
export async function audienceFromSalesforce(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: { accountId: string; name: string; soql: string; emailField?: string },
): Promise<AudienceUploadResult & { fetchedFromSalesforce: number }> {
  const emails = await emailsFromSoql(input.soql, input.emailField);
  if (emails.length === 0) throw new Error("Salesforce query returned no emails.");
  const result = await uploadAudienceFromEmails(client, getToken, {
    accountId: input.accountId,
    name: input.name,
    emails,
  });
  return { ...result, fetchedFromSalesforce: emails.length };
}
