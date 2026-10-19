import { parse } from "csv-parse/sync";

/**
 * Cleans a messy CSV into LinkedIn's required matched-audience format before
 * upload: normalizes column names (aliases -> canonical), drops everything that
 * isn't a matcher, and turns company domains into website URLs.
 *
 * Two list types:
 *  - contact (USER_LIST_UPLOAD): matched by email. Kept column: `email`.
 *  - company (COMPANY_LIST_UPLOAD): matched by website. Kept columns:
 *    `companyname`, `companywebsite` (full https:// URL, since LinkedIn matches
 *    accounts on the website URL), and `linkedincompanypageurl` (the LinkedIn
 *    company page URL, the strongest company matcher) when present.
 */

export type AudienceType = "contact" | "company";

const normKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const EMAIL_KEYS = new Set(
  ["email", "emailaddress", "emailaddr", "mail", "workemail", "useremail", "primaryemail", "emailaddress1"],
);
const COMPANY_NAME_KEYS = new Set(
  ["companyname", "company", "accountname", "account", "organization", "organisation", "companylegalname", "name",
   "enrichcompany", "companylegal"],
);
const WEBSITE_KEYS = new Set(
  ["companywebsite", "website", "websiteurl", "url", "web", "companyurl", "companywebsiteurl", "homepage",
   "domain", "companydomain", "companyemaildomain", "emaildomain", "websitedomain", "webdomain"],
);
const LINKEDIN_PAGE_KEYS = new Set(
  ["linkedincompanypageurl", "linkedin", "linkedinurl", "linkedinpage", "linkedinpageurl",
   "companylinkedin", "companylinkedinurl", "companylinkedinpage", "linkedincompanyurl",
   "linkedincompanypage", "linkedincompany"],
);

/** Turn a domain or messy URL into a clean https:// website URL (or "" if not a domain). */
export function toWebsiteUrl(raw: string): string {
  let s = (raw ?? "").trim().toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split(/[/?#]/)[0]!.replace(/:\d+$/, "");
  if (!s.includes(".")) return "";
  return `https://${s}`;
}

/** Normalize a LinkedIn company page reference into a full https:// URL (or "" if not one). */
export function toLinkedInUrl(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return "";
  s = s.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  // Accept a bare slug ("company/acme") or a full host path; drop query/hash and trailing slash.
  s = s.split(/[?#]/)[0]!.replace(/\/+$/, "");
  if (/^linkedin\.com\//i.test(s)) return `https://www.${s}`;
  if (/^company\//i.test(s) || /^school\//i.test(s)) return `https://www.linkedin.com/${s}`;
  if (!s.includes(".") && !s.includes("/")) return "";
  return s.includes("linkedin.com") ? `https://www.${s.replace(/^.*?linkedin\.com/i, "linkedin.com")}` : "";
}

export interface CleanedCsv {
  type: AudienceType;
  /** Canonical columns kept in the output. */
  columns: string[];
  /** Cleaned rows (raw email for contacts; website is already a URL for companies). */
  rows: Record<string, string>[];
  /** Original headers that were dropped. */
  dropped: string[];
  rowCount: number;
  warnings: string[];
}

function findHeader(headers: string[], keys: Set<string>): string | undefined {
  return headers.find((h) => keys.has(normKey(h)));
}

function detectType(headers: string[]): AudienceType {
  if (findHeader(headers, EMAIL_KEYS)) return "contact";
  if (findHeader(headers, COMPANY_NAME_KEYS) || findHeader(headers, WEBSITE_KEYS)) return "company";
  throw new Error("Could not detect list type from columns. Pass an explicit type (contact|company).");
}

/** Parse + normalize a CSV into LinkedIn's matched-audience format. */
export function cleanAudienceCsv(text: string, opts: { type?: AudienceType } = {}): CleanedCsv {
  const parsed = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  return cleanAudienceRows(parsed, opts);
}

/**
 * Normalize already-parsed rows (header -> value) into LinkedIn's matched-audience
 * format. The CSV path and CRM sources such as HubSpot share this, so every list
 * is cleaned the same way whatever it came from.
 */
export function cleanAudienceRows(parsed: Record<string, string>[], opts: { type?: AudienceType } = {}): CleanedCsv {
  const headers = parsed.length ? Object.keys(parsed[0]!) : [];
  if (headers.length === 0) throw new Error("CSV has no header row.");

  const type = opts.type ?? detectType(headers);
  const warnings: string[] = [];

  if (type === "contact") {
    const emailCol = findHeader(headers, EMAIL_KEYS);
    if (!emailCol) throw new Error("No email column found for a contact list.");
    const rows = parsed.map((r) => ({ email: (r[emailCol] ?? "").trim().toLowerCase() })).filter((r) => r.email);
    const dropped = headers.filter((h) => h !== emailCol);
    if (dropped.length) warnings.push(`Dropped ${dropped.length} non-matcher column(s): ${dropped.join(", ")}.`);
    return { type, columns: ["email"], rows, dropped, rowCount: rows.length, warnings };
  }

  // company
  const nameCol = findHeader(headers, COMPANY_NAME_KEYS);
  const webCol = findHeader(headers, WEBSITE_KEYS);
  const liCol = findHeader(headers, LINKEDIN_PAGE_KEYS);
  if (!webCol && !nameCol && !liCol) throw new Error("No company name, website/domain, or LinkedIn page column found.");
  if (!webCol && !liCol) warnings.push("No website/domain or LinkedIn page column found; matching on company name only.");

  const columns = [
    ...(nameCol ? ["companyname"] : []),
    ...(webCol ? ["companywebsite"] : []),
    ...(liCol ? ["linkedincompanypageurl"] : []),
  ];
  let convertedDomains = 0;
  let blankLinkedIn = 0;
  const rows: Record<string, string>[] = [];
  for (const r of parsed) {
    const out: Record<string, string> = {};
    if (nameCol) out.companyname = (r[nameCol] ?? "").trim();
    if (webCol) {
      const url = toWebsiteUrl(r[webCol] ?? "");
      if (url) {
        out.companywebsite = url;
        if (!/^https?:\/\//i.test((r[webCol] ?? "").trim())) convertedDomains += 1;
      }
    }
    if (liCol) {
      const li = toLinkedInUrl(r[liCol] ?? "");
      if (li) out.linkedincompanypageurl = li;
      else if ((r[liCol] ?? "").trim()) blankLinkedIn += 1;
    }
    if (out.companyname || out.companywebsite || out.linkedincompanypageurl) rows.push(out);
  }
  const dropped = headers.filter((h) => h !== nameCol && h !== webCol && h !== liCol);
  if (dropped.length) warnings.push(`Dropped ${dropped.length} non-matcher column(s): ${dropped.join(", ")}.`);
  if (convertedDomains) warnings.push(`Converted ${convertedDomains} domain(s) to https:// website URLs.`);
  if (blankLinkedIn) warnings.push(`${blankLinkedIn} LinkedIn page value(s) were unparseable and left blank.`);

  return { type, columns, rows, dropped, rowCount: rows.length, warnings };
}

/** Render a CleanedCsv back to CSV text (used for company uploads and dry-run preview). */
export function cleanedToCsv(clean: CleanedCsv): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = clean.columns.join(",");
  const body = clean.rows.map((r) => clean.columns.map((c) => esc(r[c] ?? "")).join(",")).join("\n");
  return `${head}\n${body}\n`;
}
