import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import type { LinkedInClient, TokenProvider } from "./http.js";
import type { AudienceUploadInput } from "./schemas.js";
import {
  generateUploadUrl,
  uploadListCsv,
  createListUploadSegment,
  attachListToSegment,
  deleteDmpSegment,
  MAX_SEGMENT_ROWS,
  RECOMMENDED_MIN_ROWS,
  type SegmentType,
} from "./resources/dmpSegments.js";
import { cleanAudienceCsv, cleanedToCsv, type AudienceType, type CleanedCsv } from "./audienceCsv.js";

/** Normalize (trim + lowercase) and SHA256-hash an email, per LinkedIn's spec. */
export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Whether a raw value is shaped like an email address, the check every upload applies. */
export function isValidEmail(email: string): boolean {
  return !!email && EMAIL_RE.test(email);
}

/** Validate, normalize, SHA256-hash, and dedupe a list of raw emails. */
export function hashAndDedupeEmails(emails: string[]): { hashes: string[]; total: number; skipped: number } {
  const seen = new Set<string>();
  let skipped = 0;
  for (const email of emails) {
    if (!isValidEmail(email)) {
      skipped += 1;
      continue;
    }
    seen.add(hashEmail(email));
  }
  return { hashes: [...seen], total: emails.length, skipped };
}

/** Reads a CSV and returns hashed emails from the given column, deduped. */
export async function hashEmailsFromCsv(
  csvPath: string,
  emailColumn: string,
): Promise<{ hashes: string[]; total: number; skipped: number }> {
  const content = await readFile(csvPath, "utf8");
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return hashAndDedupeEmails(rows.map((r) => r[emailColumn] ?? ""));
}

export interface AudienceUploadResult {
  segmentId: string;
  uploaded: number;
  totalRows: number;
  skipped: number;
  status: "PROCESSING";
  warnings: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Full audience upload via the list-upload flow: hash emails -> generate upload
 * URL -> upload a hashed CSV -> create a LIST_UPLOAD segment -> attach the list.
 * The segment then matches asynchronously (up to 48h); poll getDmpSegment for the
 * adSegment urn to target. Needs a token for the signed binary upload.
 */
export async function uploadAudienceFromCsv(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: AudienceUploadInput,
): Promise<AudienceUploadResult> {
  const { hashes, total, skipped } = await hashEmailsFromCsv(input.csvPath, input.emailColumn);
  return uploadHashedAudience(client, getToken, { accountId: input.accountId, name: input.name, hashes, total, skipped });
}

/** Upload a matched audience from a list of raw emails (e.g. from Salesforce). */
export async function uploadAudienceFromEmails(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: { accountId: string; name: string; emails: string[] },
): Promise<AudienceUploadResult> {
  const { hashes, total, skipped } = hashAndDedupeEmails(input.emails);
  return uploadHashedAudience(client, getToken, { accountId: input.accountId, name: input.name, hashes, total, skipped });
}

/** Upload a CSV (contact or company) to LinkedIn as a matched-audience segment. */
async function uploadCsvToSegment(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: {
    accountId: string;
    name: string;
    csvText: string;
    type: SegmentType;
    uploaded: number;
    totalRows: number;
    skipped: number;
    warnings: string[];
  },
): Promise<AudienceUploadResult> {
  const token = await getToken();
  const uploadUrl = await generateUploadUrl(client, input.accountId);
  const mediaUrn = await uploadListCsv(uploadUrl, input.csvText, token);
  const segment = await createListUploadSegment(client, { accountId: input.accountId, name: input.name, type: input.type });

  // The new segment isn't immediately attachable; LinkedIn suggests ~5s but it
  // can lag with a 404. Retry on not-found; fail fast on real rejections.
  await sleep(5000);
  for (let attempt = 0; ; attempt++) {
    try {
      await attachListToSegment(client, segment.id, mediaUrn);
      break;
    } catch (err) {
      if ((err as { status?: number }).status === 404 && attempt < 4) {
        await sleep(3000);
        continue;
      }
      await deleteDmpSegment(client, segment.id).catch(() => {});
      throw err;
    }
  }

  return {
    segmentId: segment.id,
    uploaded: input.uploaded,
    totalRows: input.totalRows,
    skipped: input.skipped,
    status: "PROCESSING",
    warnings: [...input.warnings, "Segment is matching (up to 48h). Poll get_audience_status; target it once READY."],
  };
}

/** Shared core for email/contact uploads: validate sizes, hash, upload. */
async function uploadHashedAudience(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: { accountId: string; name: string; hashes: string[]; total: number; skipped: number; preWarnings?: string[] },
): Promise<AudienceUploadResult> {
  const { hashes, total, skipped } = input;
  const warnings = [...(input.preWarnings ?? [])];

  if (hashes.length === 0) throw new Error("No valid emails to upload.");
  warnings.push(...audienceSizeWarnings("contact", hashes.length));
  if (skipped > 0) warnings.push(`Skipped ${skipped} rows with missing/invalid emails.`);

  return uploadCsvToSegment(client, getToken, {
    accountId: input.accountId,
    name: input.name,
    csvText: `email\n${hashes.join("\n")}\n`,
    type: "USER_LIST_UPLOAD",
    uploaded: hashes.length,
    totalRows: total,
    skipped,
    warnings,
  });
}

/** Min recommended rows for a company list (contacts use RECOMMENDED_MIN_ROWS). */
const RECOMMENDED_MIN_COMPANIES = 1000;

/**
 * LinkedIn's list-size rules for a matched audience of `rows` valid rows: throws
 * above the per-upload cap, and returns a warning below the recommended minimum.
 * Uploads and dry runs both apply it, so a preview fails where the upload would.
 */
export function audienceSizeWarnings(type: AudienceType, rows: number): string[] {
  const unit = type === "contact" ? "emails" : "companies";
  if (rows > MAX_SEGMENT_ROWS) {
    throw new Error(`List has ${rows} ${unit}; LinkedIn caps a single upload at ${MAX_SEGMENT_ROWS}.`);
  }
  if (type === "contact" && rows < RECOMMENDED_MIN_ROWS) {
    return [
      `Only ${rows} valid emails. LinkedIn recommends >= ${RECOMMENDED_MIN_ROWS} and needs ~300 matched members to serve. Match rates run ~30-60%, so a small list may never become targetable.`,
    ];
  }
  if (type === "company" && rows < RECOMMENDED_MIN_COMPANIES) {
    return [`Only ${rows} companies. LinkedIn recommends >= ${RECOMMENDED_MIN_COMPANIES}.`];
  }
  return [];
}

/**
 * Clean a CSV (fix column names, drop non-matcher columns, turn domains into
 * website URLs) and upload it as the right list type (auto-detected, or forced
 * via `type`). Contacts are hashed; companies upload name + website.
 */
export async function uploadAudienceFromFile(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: { accountId: string; name: string; csvPath: string; type?: AudienceType },
): Promise<AudienceUploadResult & { audienceType: AudienceType }> {
  const text = await readFile(input.csvPath, "utf8");
  const clean = cleanAudienceCsv(text, { type: input.type });
  if (clean.rowCount === 0) throw new Error("No usable rows after cleaning the CSV.");
  return uploadCleanedAudience(client, getToken, { accountId: input.accountId, name: input.name, clean });
}

/**
 * Upload a list that has already been cleaned (by cleanAudienceCsv or
 * cleanAudienceRows) as the matching segment type. Contacts are SHA256-hashed
 * and deduped, so only hashes leave the machine; companies upload name +
 * website. Shared by CSV files and CRM sources, so they upload the same way.
 */
export async function uploadCleanedAudience(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: { accountId: string; name: string; clean: CleanedCsv },
): Promise<AudienceUploadResult & { audienceType: AudienceType }> {
  const { clean } = input;
  if (clean.type === "contact") {
    const { hashes, total, skipped } = hashAndDedupeEmails(clean.rows.map((r) => r.email ?? ""));
    const res = await uploadHashedAudience(client, getToken, {
      accountId: input.accountId,
      name: input.name,
      hashes,
      total,
      skipped,
      preWarnings: clean.warnings,
    });
    return { ...res, audienceType: "contact" };
  }

  // company
  if (clean.rowCount === 0) throw new Error("No companies to upload.");
  const warnings = [...clean.warnings, ...audienceSizeWarnings("company", clean.rowCount)];
  const res = await uploadCsvToSegment(client, getToken, {
    accountId: input.accountId,
    name: input.name,
    csvText: cleanedToCsv(clean),
    type: "COMPANY_LIST_UPLOAD",
    uploaded: clean.rowCount,
    totalRows: clean.rowCount,
    skipped: 0,
    warnings,
  });
  return { ...res, audienceType: "company" };
}
