import {
  sleep,
  isRetryableStatus,
  retryDelayMs,
  transportRetryDelayMs,
  DEFAULT_MAX_RETRIES,
  type TokenProvider,
} from "@adwarp/shared";
import { apiVersion, type GoogleAdsConfig } from "./config.js";

export const GOOGLE_ADS_BASE = "https://googleads.googleapis.com";

/** One failure inside a GoogleAdsFailure, flattened into something readable. */
export interface GoogleAdsFieldError {
  /** e.g. "fieldError" */
  codeGroup: string;
  /** e.g. "REQUIRED" */
  code: string;
  message: string;
  /** Dotted path into the request, e.g. "operations[0].create.campaignBudget". */
  fieldPath?: string;
  /** The offending value, when the API echoes one back. */
  trigger?: unknown;
}

export class GoogleAdsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    /** Flattened GoogleAdsFailure entries, empty for non-Ads errors (auth, quota). */
    readonly errors: GoogleAdsFieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "GoogleAdsApiError";
  }
}

export interface GoogleRequestOptions {
  method?: "GET" | "POST";
  /** Path below the version segment, e.g. "/customers/123/googleAds:mutate". */
  path: string;
  body?: unknown;
  /** Suppresses the mutation hook for reads issued through a POST (search, keyword ideas). */
  isRead?: boolean;
}

/** A successful write, handed to the change journal. */
export interface GoogleMutationEvent {
  path: string;
  body?: unknown;
  response: unknown;
  customerId?: string;
}

export type GoogleMutationHook = (m: GoogleMutationEvent) => void | Promise<void>;

/**
 * Turn Google's nested error envelope into a flat, readable list.
 *
 * A failed mutate returns `error.details[]` holding a GoogleAdsFailure whose
 * `errors[]` each carry an `errorCode` object with exactly one key (the error
 * family) and a `location.fieldPathElements[]` describing where in the request
 * it went wrong. Left un-flattened this reads as an opaque 400, which is the
 * single most common complaint about this API.
 */
export function flattenGoogleAdsErrors(body: unknown): { errors: GoogleAdsFieldError[]; requestId?: string } {
  // searchStream wraps everything in an array, failures included, so a 403 from
  // it arrives as [{ error: {...} }] rather than { error: {...} }. Unwrap that
  // first or every streaming error reads as raw JSON.
  const envelope = Array.isArray(body) ? body.find((c: any) => c?.error) : body;
  const details = (envelope as any)?.error?.details;
  if (!Array.isArray(details)) return { errors: [] };

  const errors: GoogleAdsFieldError[] = [];
  let requestId: string | undefined;

  for (const detail of details) {
    if (detail?.requestId) requestId = detail.requestId;
    if (!Array.isArray(detail?.errors)) continue;
    for (const e of detail.errors) {
      const [codeGroup, code] = Object.entries(e?.errorCode ?? {})[0] ?? ["unknown", "UNKNOWN"];
      const path = (e?.location?.fieldPathElements ?? [])
        .map((p: any) => (p?.index === undefined ? p?.fieldName : `${p?.fieldName}[${p.index}]`))
        .filter(Boolean)
        .join(".");
      errors.push({
        codeGroup: String(codeGroup),
        code: String(code),
        message: String(e?.message ?? ""),
        fieldPath: path || undefined,
        trigger: e?.trigger,
      });
    }
  }
  return { errors, requestId };
}

function describe(errors: GoogleAdsFieldError[], fallback: string, status: number): string {
  if (!errors.length) return fallback || `Google Ads API ${status}`;
  return errors
    .map((e) => `${e.codeGroup}.${e.code}${e.fieldPath ? ` at ${e.fieldPath}` : ""}: ${e.message}`)
    .join("; ");
}

/**
 * The one place every Google Ads REST call flows through. Injects the bearer
 * token, developer token, and login-customer-id; retries on 429/5xx; and turns
 * GoogleAdsFailure envelopes into readable errors.
 */
export class GoogleAdsClient {
  constructor(
    private readonly config: GoogleAdsConfig,
    private readonly getToken: TokenProvider,
    /** Optional: notified after every successful write, for change journaling. */
    private readonly onMutation?: GoogleMutationHook,
  ) {}

  get version(): string {
    return apiVersion(this.config);
  }

  async request<T = unknown>(opts: GoogleRequestOptions): Promise<T> {
    const url = `${GOOGLE_ADS_BASE}/${this.version}${opts.path}`;
    const method = opts.method ?? "POST";

    let lastErr: unknown;
    for (let attempt = 0; attempt <= DEFAULT_MAX_RETRIES; attempt++) {
      const token = await this.getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "developer-token": this.config.developerToken,
      };
      // Only needed when reaching the account through a manager. Sending an
      // unrelated one is an authorization error, so it is opt-in via config.
      if (this.config.loginCustomerId) {
        headers["login-customer-id"] = this.config.loginCustomerId.replace(/\D/g, "");
      }
      let bodyStr: string | undefined;
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        bodyStr = JSON.stringify(opts.body);
      }

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
      const data = text ? safeJson(text) : undefined;

      if (!res.ok) {
        const { errors, requestId } = flattenGoogleAdsErrors(data);
        const envelope = Array.isArray(data) ? data.find((c: any) => c?.error) : data;
        const fallback = (envelope as any)?.error?.message ?? text;
        throw new GoogleAdsApiError(describe(errors, fallback, res.status), res.status, data ?? text, errors, requestId);
      }

      // searchStream returns a JSON array of chunks; an error can still ride
      // inside it with a 200, so check the payload as well as the status.
      const embedded = Array.isArray(data) ? data.find((c: any) => c?.error) : (data as any)?.error ? data : undefined;
      if (embedded) {
        const { errors, requestId } = flattenGoogleAdsErrors(embedded);
        const fallback = (embedded as any)?.error?.message ?? "Google Ads API error";
        throw new GoogleAdsApiError(describe(errors, fallback, res.status), res.status, embedded, errors, requestId);
      }

      if (this.onMutation && !opts.isRead) {
        try {
          await this.onMutation({
            path: opts.path,
            body: opts.body,
            response: data,
            customerId: opts.path.match(/\/customers\/(\d+)/)?.[1],
          });
        } catch {
          /* change journaling is non-critical */
        }
      }

      return data as T;
    }
    throw lastErr instanceof Error ? lastErr : new Error("Request failed");
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
