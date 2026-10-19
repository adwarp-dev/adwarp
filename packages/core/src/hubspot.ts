import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ADWARP_DIR,
  DEFAULT_MAX_RETRIES,
  displayPath,
  env,
  isRetryableStatus,
  retryDelayMs,
  sleep,
  transportRetryDelayMs,
} from "@adwarp/shared";
import type { LinkedInClient, TokenProvider } from "./http.js";
import { audienceSizeWarnings, hashEmail, isValidEmail, uploadCleanedAudience } from "./audience.js";
import { cleanAudienceRows, type AudienceType, type CleanedCsv } from "./audienceCsv.js";
import { HubSpotFilterSchema, type HubSpotAudienceInput, type HubSpotFilter } from "./schemas.js";

/**
 * Reads contacts and companies from HubSpot to feed a LinkedIn matched audience,
 * the same way the Salesforce reader does: a HubSpot list (its memberships) or a
 * CRM search becomes records, the records go through the CSV cleaning path, and
 * the result uploads like any other list. Contacts leave the machine only as
 * SHA256 email hashes.
 *
 * Auth is a HubSpot private app access token the user creates in their own
 * account, with the read-only crm.objects.contacts.read,
 * crm.objects.companies.read and crm.lists.read scopes. There is no OAuth, and
 * nothing here writes to HubSpot.
 */

export const HUBSPOT_API_BASE = "https://api.hubapi.com";

/**
 * HubSpot's date-based API version. Pinned deliberately: each version is
 * supported for 18 months, and HubSpot ends support for the older v3 paths in
 * September 2027, so bumping is a decision, not a default.
 */
export const HUBSPOT_API_VERSION = "2026-09";

const CONFIG_PATH = join(ADWARP_DIR, "hubspot.json");
export const hubspotConfigPath = CONFIG_PATH;

/** The private app scopes this integration needs, all read-only. */
export const HUBSPOT_SCOPES = ["crm.objects.contacts.read", "crm.objects.companies.read", "crm.lists.read"] as const;

const SCOPE_LIST = `${HUBSPOT_SCOPES.slice(0, -1).join(", ")} and ${HUBSPOT_SCOPES[HUBSPOT_SCOPES.length - 1]}`;

/** HubSpot object type ids for the 2 object types a LinkedIn list can hold. */
const OBJECT_TYPE_ID: Record<AudienceType, string> = { contact: "0-1", company: "0-2" };
const OBJECT_PATH: Record<AudienceType, string> = { contact: "contacts", company: "companies" };
const NOUN: Record<AudienceType, string> = { contact: "contacts", company: "companies" };

/**
 * The properties read per record: only what LinkedIn matches on. Contacts match
 * on email alone, as in the CSV path. Companies match on name and domain;
 * HubSpot fills `domain` from the Website URL property.
 */
const PROPERTIES: Record<AudienceType, string[]> = { contact: ["email"], company: ["name", "domain"] };

/** Search: 200 records per page, 10,000 results per query, 5 requests per second. */
const SEARCH_PAGE_SIZE = 200;
export const HUBSPOT_SEARCH_RESULT_CAP = 10_000;
const SEARCH_INTERVAL_MS = 250;
/** List memberships page size (HubSpot's documented default). */
const MEMBERSHIP_PAGE_SIZE = 100;
/** Batch read takes at most 100 records per request. */
const BATCH_READ_SIZE = 100;
/** Stay under 100 requests per 10 seconds, the private app burst limit on Free and Starter. */
const REQUEST_INTERVAL_MS = 100;

const SAMPLE_ROWS = 5;

/* ---------------------------------- auth ------------------------------------ */

/**
 * The private app access token: ADWARP_HUBSPOT_TOKEN first, then
 * `{ "accessToken": "..." }` in hubspot.json in the Adwarp folder.
 */
export async function loadHubSpotToken(): Promise<string> {
  const fromEnv = env("ADWARP_HUBSPOT_TOKEN")?.trim();
  if (fromEnv) return fromEnv;
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No HubSpot access token. Create a private app in HubSpot with the ${SCOPE_LIST} scopes, then save its access token as { "accessToken": "..." } in ${displayPath(CONFIG_PATH)} (mode 0600), or set ADWARP_HUBSPOT_TOKEN.`,
    );
  }
  let parsed: { accessToken?: unknown };
  try {
    parsed = JSON.parse(raw) as { accessToken?: unknown };
  } catch {
    throw new Error(`${displayPath(CONFIG_PATH)} is not valid JSON. Expected { "accessToken": "..." }.`);
  }
  const token = typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";
  if (!token) throw new Error(`${displayPath(CONFIG_PATH)} must include accessToken.`);
  return token;
}

/* ---------------------------------- http ------------------------------------ */

export class HubSpotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HubSpotApiError";
  }
}

interface HubSpotRequest {
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

function describeError(status: number, data: unknown, text: string): string {
  const body = (data && typeof data === "object" ? data : {}) as {
    message?: string;
    context?: { missingScopes?: string[] };
  };
  const message = body.message ?? (text || `HubSpot API ${status}`);
  if (status === 401) {
    return `HubSpot rejected the access token (401): ${message}. Check ADWARP_HUBSPOT_TOKEN or ${displayPath(CONFIG_PATH)}.`;
  }
  if (status === 403) {
    const missing = body.context?.missingScopes?.length ? ` Missing: ${body.context.missingScopes.join(", ")}.` : "";
    return `HubSpot refused the request (403): ${message}. The private app needs the ${SCOPE_LIST} scopes.${missing}`;
  }
  return `HubSpot API ${status}: ${message}`;
}

/**
 * Every HubSpot call goes through a single client: bearer token, JSON, pacing under
 * the private app burst limit, and the shared retry policy on 429 / 5xx.
 */
function hubspotClient(token: string) {
  let last = 0;
  return async function request<T>(opts: HubSpotRequest, intervalMs = REQUEST_INTERVAL_MS): Promise<T> {
    const url = new URL(HUBSPOT_API_BASE + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const method = opts.method ?? "GET";
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(opts.body);
    }

    let lastErr: unknown;
    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      const wait = last + intervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();

      let res: Response;
      try {
        res = await fetch(url, { method, headers, body: bodyStr });
      } catch (err) {
        lastErr = err;
        if (attempt < DEFAULT_MAX_RETRIES) {
          await sleep(transportRetryDelayMs(attempt));
          continue;
        }
        throw err;
      }
      if (isRetryableStatus(res.status) && attempt < DEFAULT_MAX_RETRIES) {
        await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      const text = await res.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = text;
      }
      if (!res.ok) throw new HubSpotApiError(describeError(res.status, data, text), res.status, data);
      return data as T;
    }
    throw lastErr instanceof Error ? lastErr : new Error("HubSpot request failed");
  };
}

type HubSpotRequester = ReturnType<typeof hubspotClient>;

interface HubSpotRecord {
  id: string;
  properties?: Record<string, string | null | undefined>;
}

interface Paged<T> {
  results?: T[];
  total?: number;
  paging?: { next?: { after?: string } };
}

/* --------------------------------- search ----------------------------------- */

/** HubSpot's search filter shape for a single simple filter. */
export function toHubSpotSearchFilter(filter: HubSpotFilter): Record<string, unknown> {
  const { property: propertyName, operator } = HubSpotFilterSchema.parse(filter);
  if (operator === "HAS_PROPERTY" || operator === "NOT_HAS_PROPERTY") return { propertyName, operator };
  const value = (filter.value ?? "").trim();
  if (!value) throw new Error(`The ${operator} filter on ${propertyName} needs a value.`);
  if (operator === "IN" || operator === "NOT_IN") {
    const values = value.split(",").map((v) => v.trim()).filter(Boolean);
    return { propertyName, operator, values };
  }
  if (operator === "BETWEEN") {
    const parts = value.split(",").map((v) => v.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`The BETWEEN filter on ${propertyName} needs "low,high", got "${value}".`);
    }
    return { propertyName, operator, value: parts[0], highValue: parts[1] };
  }
  return { propertyName, operator, value };
}

/**
 * Parse a CLI filter, `<property>:<operator>:<value>`. The value keeps any
 * further colons; HAS_PROPERTY and NOT_HAS_PROPERTY take no value.
 */
export function parseHubSpotFilter(spec: string): HubSpotFilter {
  const first = spec.indexOf(":");
  if (first <= 0) throw new Error(`Filter "${spec}" should look like <property>:<operator>:<value>, e.g. lifecyclestage:EQ:customer.`);
  const property = spec.slice(0, first).trim();
  const rest = spec.slice(first + 1);
  const second = rest.indexOf(":");
  const operator = (second === -1 ? rest : rest.slice(0, second)).trim().toUpperCase();
  const value = second === -1 ? undefined : rest.slice(second + 1);
  const parsed = HubSpotFilterSchema.safeParse({ property, operator, value });
  if (!parsed.success) {
    throw new Error(
      `Filter "${spec}" has an unknown operator "${operator}". Use any of ${HubSpotFilterSchema.shape.operator.options.join(", ")}.`,
    );
  }
  toHubSpotSearchFilter(parsed.data);
  return parsed.data;
}

async function searchRecords(request: HubSpotRequester, type: AudienceType, filters: HubSpotFilter[]): Promise<HubSpotRecord[]> {
  const body = {
    filterGroups: [{ filters: filters.map(toHubSpotSearchFilter) }],
    properties: PROPERTIES[type],
    limit: SEARCH_PAGE_SIZE,
  };
  const records: HubSpotRecord[] = [];
  let after: string | undefined;
  let first = true;
  do {
    const page = await request<Paged<HubSpotRecord>>(
      { method: "POST", path: `/crm/objects/${HUBSPOT_API_VERSION}/${OBJECT_PATH[type]}/search`, body: after ? { ...body, after } : body },
      SEARCH_INTERVAL_MS,
    );
    if (first && (page.total ?? 0) > HUBSPOT_SEARCH_RESULT_CAP) {
      throw new Error(
        `This HubSpot search matches ${page.total} ${NOUN[type]}, and HubSpot returns at most ${HUBSPOT_SEARCH_RESULT_CAP} results per search. Narrow the filters, or save the records as a HubSpot list and pass its list id, which has no such cap.`,
      );
    }
    first = false;
    records.push(...(page.results ?? []));
    const next = page.paging?.next?.after;
    after = next && next !== after ? next : undefined;
  } while (after);
  return records;
}

/* ---------------------------------- lists ----------------------------------- */

interface HubSpotList {
  listId: string;
  name: string;
  objectTypeId: string;
  processingType?: string;
  size?: number;
}

async function getList(request: HubSpotRequester, listId: string): Promise<HubSpotList> {
  try {
    const res = await request<{ list: HubSpotList }>({ path: `/crm/lists/${HUBSPOT_API_VERSION}/${encodeURIComponent(listId)}` });
    return res.list;
  } catch (err) {
    if (err instanceof HubSpotApiError && err.status === 404) {
      throw new Error(`HubSpot has no list with id ${listId}. Find a list's id in HubSpot under Segments: hover the list, then click Details.`);
    }
    throw err;
  }
}

async function listMemberIds(request: HubSpotRequester, listId: string): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  do {
    const page = await request<Paged<{ recordId: string }>>({
      path: `/crm/lists/${HUBSPOT_API_VERSION}/${encodeURIComponent(listId)}/memberships`,
      query: { limit: MEMBERSHIP_PAGE_SIZE, after },
    });
    for (const m of page.results ?? []) if (m.recordId !== undefined) ids.push(String(m.recordId));
    const next = page.paging?.next?.after;
    after = next && next !== after ? next : undefined;
  } while (after);
  return [...new Set(ids)];
}

async function batchRead(request: HubSpotRequester, type: AudienceType, ids: string[]): Promise<HubSpotRecord[]> {
  const records: HubSpotRecord[] = [];
  for (let i = 0; i < ids.length; i += BATCH_READ_SIZE) {
    const chunk = ids.slice(i, i + BATCH_READ_SIZE);
    const res = await request<{ results?: HubSpotRecord[] }>({
      method: "POST",
      path: `/crm/objects/${HUBSPOT_API_VERSION}/${OBJECT_PATH[type]}/batch/read`,
      body: { properties: PROPERTIES[type], inputs: chunk.map((id) => ({ id })) },
    });
    records.push(...(res.results ?? []));
  }
  return records;
}

/* --------------------------------- reading ---------------------------------- */

export type HubSpotSource =
  | { kind: "list"; listId: string; listName: string; processingType?: string }
  | { kind: "search"; filters: HubSpotFilter[] };

/** HubSpot records read and cleaned into LinkedIn's list format, before any upload. */
export interface HubSpotAudienceRead {
  audienceType: AudienceType;
  source: HubSpotSource;
  /** Records read from HubSpot. */
  read: number;
  /** Rows left to upload: unique valid emails, or companies with a name or website. */
  valid: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  clean: CleanedCsv;
  /** Notes about the HubSpot read itself. Cleaning notes stay on `clean.warnings`. */
  warnings: string[];
}

const prop = (r: HubSpotRecord, key: string): string => {
  const v = r.properties?.[key];
  return v === null || v === undefined ? "" : String(v);
};

/**
 * Read a HubSpot list or search fully and clean it. Throws on a missing token,
 * a bad source, a list of another object type, or a search over HubSpot's cap.
 */
export async function readHubSpotAudience(
  input: Pick<HubSpotAudienceInput, "type" | "listId" | "filters">,
  opts: { token?: string } = {},
): Promise<HubSpotAudienceRead> {
  const hasList = !!input.listId;
  const hasFilters = !!input.filters?.length;
  if (hasList === hasFilters) {
    throw new Error("Pass exactly 1 HubSpot source: a list id, or filters for a CRM search.");
  }
  const request = hubspotClient(opts.token ?? (await loadHubSpotToken()));

  let type: AudienceType;
  let source: HubSpotSource;
  let records: HubSpotRecord[];
  let notFound = 0;
  if (input.listId) {
    const list = await getList(request, input.listId);
    const listType = (Object.keys(OBJECT_TYPE_ID) as AudienceType[]).find((t) => OBJECT_TYPE_ID[t] === list.objectTypeId);
    if (!listType) {
      throw new Error(
        `HubSpot list ${input.listId} holds object type ${list.objectTypeId}. Only contact (0-1) and company (0-2) lists can become LinkedIn audiences.`,
      );
    }
    if (input.type && input.type !== listType) {
      throw new Error(`HubSpot list ${input.listId} is a ${listType} list, but type is ${input.type}. Drop type or pass ${listType}.`);
    }
    type = listType;
    source = { kind: "list", listId: input.listId, listName: list.name, processingType: list.processingType };
    const ids = await listMemberIds(request, input.listId);
    records = await batchRead(request, type, ids);
    notFound = Math.max(0, ids.length - records.length);
  } else {
    type = input.type ?? "contact";
    source = { kind: "search", filters: input.filters! };
    records = await searchRecords(request, type, input.filters!);
  }

  const read = records.length + notFound;
  const skippedReasons: Record<string, number> = {};
  const add = (reason: string, n: number) => {
    if (n > 0) skippedReasons[reason] = (skippedReasons[reason] ?? 0) + n;
  };
  add("not found in HubSpot", notFound);

  let clean: CleanedCsv;
  let valid: number;
  if (type === "contact") {
    clean = records.length
      ? cleanAudienceRows(records.map((r) => ({ email: prop(r, "email") })), { type })
      : emptyClean(type);
    add("no email", records.length - clean.rowCount);
    const seen = new Set<string>();
    let invalid = 0;
    for (const row of clean.rows) {
      if (!isValidEmail(row.email ?? "")) invalid += 1;
      else seen.add(hashEmail(row.email!));
    }
    add("invalid email", invalid);
    add("duplicate email", clean.rowCount - invalid - seen.size);
    valid = seen.size;
  } else {
    clean = records.length
      ? cleanAudienceRows(
          records.map((r) => ({ companyname: prop(r, "name").trim(), companywebsite: prop(r, "domain") })),
          { type },
        )
      : emptyClean(type);
    add("no name or domain", records.length - clean.rowCount);
    valid = clean.rowCount;
  }

  const skipped = Object.values(skippedReasons).reduce((a, b) => a + b, 0);
  const warnings: string[] = [];
  if (notFound > 0) warnings.push(`${notFound} list member(s) no longer exist in HubSpot and were skipped.`);
  return { audienceType: type, source, read, valid, skipped, skippedReasons, clean, warnings };
}

function emptyClean(type: AudienceType): CleanedCsv {
  const columns = type === "contact" ? ["email"] : ["companyname", "companywebsite"];
  return { type, columns, rows: [], dropped: [], rowCount: 0, warnings: [] };
}

function describeSource(source: HubSpotSource): string {
  return source.kind === "list" ? `list ${source.listId} ("${source.listName}")` : "search";
}

/** Show the start and the domain of an email, so a sample proves the data without exposing it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, local.length > 2 ? 2 : 1)}***${email.slice(at)}`;
}

/* --------------------------------- results ---------------------------------- */

interface HubSpotAudienceCounts {
  name: string;
  audienceType: AudienceType;
  source: HubSpotSource;
  read: number;
  valid: number;
  uploaded: number;
  skipped: number;
  skippedReasons: Record<string, number>;
  warnings: string[];
}

export interface HubSpotAudiencePreview extends HubSpotAudienceCounts {
  dryRun: true;
  columns: string[];
  /** A few cleaned rows. Emails are masked and shown with the SHA256 hash that would upload. */
  sample: Record<string, string>[];
}

export interface HubSpotAudienceResult extends HubSpotAudienceCounts {
  dryRun: false;
  segmentId: string;
  status: "PROCESSING";
}

/**
 * Dry run: read and clean the HubSpot records and report counts plus a sample.
 * Uploads nothing and needs no LinkedIn credentials.
 */
export async function previewHubSpotAudience(
  input: Pick<HubSpotAudienceInput, "name" | "type" | "listId" | "filters">,
  opts: { token?: string } = {},
): Promise<HubSpotAudiencePreview> {
  const r = await readHubSpotAudience(input, opts);
  const warnings = [...r.warnings, ...r.clean.warnings];
  if (r.read === 0) warnings.push(`HubSpot ${describeSource(r.source)} returned no ${NOUN[r.audienceType]}. Nothing would upload.`);
  else if (r.valid === 0) warnings.push(`None of the ${r.read} ${NOUN[r.audienceType]} can be matched. Nothing would upload.`);
  else warnings.push(...audienceSizeWarnings(r.audienceType, r.valid));

  let columns: string[];
  let sample: Record<string, string>[];
  if (r.audienceType === "contact") {
    columns = ["email", "sha256"];
    const seen = new Set<string>();
    sample = [];
    for (const row of r.clean.rows) {
      const email = row.email ?? "";
      if (!isValidEmail(email)) continue;
      const hash = hashEmail(email);
      if (seen.has(hash)) continue;
      seen.add(hash);
      sample.push({ email: maskEmail(email), sha256: hash });
      if (sample.length === SAMPLE_ROWS) break;
    }
  } else {
    columns = r.clean.columns;
    sample = r.clean.rows.slice(0, SAMPLE_ROWS);
  }

  return {
    dryRun: true,
    name: input.name,
    audienceType: r.audienceType,
    source: r.source,
    read: r.read,
    valid: r.valid,
    uploaded: 0,
    skipped: r.skipped,
    skippedReasons: r.skippedReasons,
    columns,
    sample,
    warnings,
  };
}

/**
 * Closes the loop: a HubSpot list or CRM search becomes a LinkedIn
 * matched-audience DMP segment, through the same cleaning, hashing and upload
 * path as a CSV. Reads HubSpot fully before touching LinkedIn.
 */
export async function audienceFromHubSpot(
  client: LinkedInClient,
  getToken: TokenProvider,
  input: Pick<HubSpotAudienceInput, "name" | "type" | "listId" | "filters"> & { accountId: string },
  opts: { token?: string } = {},
): Promise<HubSpotAudienceResult> {
  const r = await readHubSpotAudience(input, opts);
  if (r.read === 0) throw new Error(`HubSpot ${describeSource(r.source)} returned no ${NOUN[r.audienceType]}.`);
  if (r.valid === 0) {
    const reasons = Object.entries(r.skippedReasons).map(([k, v]) => `${k}: ${v}`).join(", ");
    throw new Error(`None of the ${r.read} HubSpot ${NOUN[r.audienceType]} can be matched (${reasons}).`);
  }
  const res = await uploadCleanedAudience(client, getToken, { accountId: input.accountId, name: input.name, clean: r.clean });
  return {
    dryRun: false,
    name: input.name,
    audienceType: r.audienceType,
    source: r.source,
    segmentId: res.segmentId,
    status: res.status,
    read: r.read,
    valid: r.valid,
    uploaded: res.uploaded,
    skipped: r.skipped,
    skippedReasons: r.skippedReasons,
    warnings: [...r.warnings, ...res.warnings],
  };
}
