import { parse } from "csv-parse/sync";

/**
 * Cleans a messy CSV into LinkedIn's required matched-audience format before
 * upload: normalizes column names (aliases -> canonical), drops everything that
 * isn't a matcher, and turns company domains into website URLs.
 *
 * Two list types:
 *  - contact (USER_LIST_UPLOAD): matched by email, and by LinkedIn's people match
 *    on name, company, title and country. Kept columns: `email`, `firstname`,
 *    `lastname`, `employeecompany`, `title`, `country` when present. A row needs
 *    an email or a first and last name.
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

// Contact-list people-match columns. `name` is left out of the company keys here,
// since on a contact list it is usually the person's name.
const FIRST_NAME_KEYS = new Set(["firstname", "first", "fn", "givenname", "fname"]);
const LAST_NAME_KEYS = new Set(["lastname", "last", "ln", "surname", "familyname", "lname"]);
const EMPLOYEE_COMPANY_KEYS = new Set(
  ["employeecompany", "company", "companyname", "accountname", "account", "organization", "organisation",
   "employer", "currentcompany"],
);
const TITLE_KEYS = new Set(["title", "jobtitle", "position", "currenttitle"]);
const COUNTRY_KEYS = new Set(["country", "countrycode"]);

/** LinkedIn's length caps for the plain-text contact columns. */
const CONTACT_MAX_LENGTH: Record<string, number> = { firstname: 35, lastname: 35, employeecompany: 50, title: 50 };

/** LinkedIn rejects the whole file if any plain-text column holds an email address. */
const EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[^\s@]+/;

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
  if (findHeader(headers, FIRST_NAME_KEYS) && findHeader(headers, LAST_NAME_KEYS)) return "contact";
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
    const firstCol = findHeader(headers, FIRST_NAME_KEYS);
    const lastCol = findHeader(headers, LAST_NAME_KEYS);
    if (!emailCol && !(firstCol && lastCol)) {
      throw new Error("No email column, or first and last name columns, found for a contact list.");
    }
    const sources: [string, string | undefined][] = [
      ["email", emailCol],
      ["firstname", firstCol],
      ["lastname", lastCol],
      ["employeecompany", findHeader(headers, EMPLOYEE_COMPANY_KEYS)],
      ["title", findHeader(headers, TITLE_KEYS)],
      ["country", findHeader(headers, COUNTRY_KEYS)],
    ];
    const kept = sources.filter((s): s is [string, string] => !!s[1]);
    const columns = kept.map(([c]) => c);

    let badCountry = 0;
    let emailInText = 0;
    const rows: Record<string, string>[] = [];
    for (const r of parsed) {
      const out: Record<string, string> = {};
      for (const [col, header] of kept) {
        let v = (r[header] ?? "").trim();
        if (col === "email") v = v.toLowerCase();
        else if (EMAIL_IN_TEXT.test(v)) {
          emailInText += 1;
          v = "";
        }
        if (col === "country" && v) {
          // LinkedIn takes an ISO two-letter code only.
          if (/^[a-z]{2}$/i.test(v)) v = v.toUpperCase();
          else {
            badCountry += 1;
            v = "";
          }
        }
        const max = CONTACT_MAX_LENGTH[col];
        if (max && v.length > max) v = v.slice(0, max).trim();
        if (v) out[col] = v;
      }
      if (out.email || (out.firstname && out.lastname)) rows.push(out);
    }
    const used = new Set(kept.map(([, h]) => h));
    const dropped = headers.filter((h) => !used.has(h));
    if (dropped.length) warnings.push(`Dropped ${dropped.length} non-matcher column(s): ${dropped.join(", ")}.`);
    if (badCountry) warnings.push(`${badCountry} country value(s) were not two-letter ISO codes and were left blank.`);
    if (emailInText) {
      warnings.push(`${emailInText} name, company or title value(s) held an email address and were left blank (LinkedIn rejects raw emails).`);
    }
    return { type, columns, rows, dropped, rowCount: rows.length, warnings };
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
