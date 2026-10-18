import {
  sleep,
  isRetryableStatus,
  retryDelayMs,
  transportRetryDelayMs,
  DEFAULT_MAX_RETRIES,
  type TokenProvider,
} from "@adwarp/shared";
import { type AppConfig, linkedinVersion } from "./config.js";

export const LINKEDIN_REST_BASE = "https://api.linkedin.com/rest";

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly serviceErrorCode?: number,
  ) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** Path relative to the REST base, e.g. "/adAccounts". */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /**
   * Pre-built query string appended verbatim (no re-encoding). Use for restli
   * 2.0 finders whose value mixes literal structure chars `(),:` with
   * percent-encoded URNs (e.g. audienceCounts targetingCriteria). Takes
   * precedence over `query`.
   */
  rawQuery?: string;
  body?: unknown;
  /** Extra headers (merged over defaults). */
  headers?: Record<string, string>;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  /** Value of the x-restli-id response header (the created entity id), when present. */
  restliId?: string;
  headers: Headers;
}

/**
 * A successful write (POST/PUT/DELETE) as seen at the HTTP layer. Emitted to an
 * optional `onMutation` hook so callers can journal ad changes without every
 * resource function having to opt in. Carries enough to reconstruct what changed:
 * the path/method identify the entity + operation, `restliId` is the created id,
 * and `body` holds the create payload or a PARTIAL_UPDATE `patch.$set`.
 */
export interface MutationEvent {
  method: string;
  path: string;
  query?: RequestOptions["query"];
  headers?: Record<string, string>;
  body?: unknown;
  status: number;
  restliId?: string;
}

/** Side-effect hook invoked after a successful write. Must never throw. */
export type MutationHook = (m: MutationEvent) => void | Promise<void>;

/** Supplies a valid (auto-refreshed) bearer token. Built in auth.ts. */
export type { TokenProvider };

const MAX_RETRIES = DEFAULT_MAX_RETRIES;

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(LINKEDIN_REST_BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * The one place every LinkedIn REST call flows through. Injects the versioned
 * headers, the bearer token, parses x-restli-id, and retries on 429 / 5xx.
 */
export class LinkedInClient {
  constructor(
    private readonly config: AppConfig,
    private readonly getToken: TokenProvider,
    /** Optional: notified after every successful write, for change journaling. */
    private readonly onMutation?: MutationHook,
  ) {}

  async request<T = unknown>(opts: RequestOptions): Promise<ApiResponse<T>> {
    const url = opts.rawQuery
      ? `${LINKEDIN_REST_BASE}${opts.path}?${opts.rawQuery}`
      : buildUrl(opts.path, opts.query);
    const method = opts.method ?? "GET";

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const token = await this.getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "LinkedIn-Version": linkedinVersion(this.config),
        "X-Restli-Protocol-Version": "2.0.0",
        ...opts.headers,
      };
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
        if (attempt < MAX_RETRIES) {
          await sleep(transportRetryDelayMs(attempt));
          continue;
        }
        throw err;
      }

      if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
        await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
        continue;
      }

      const text = await res.text();
      const data = text ? safeJson(text) : undefined;

      if (!res.ok) {
        const serviceErrorCode =
          data && typeof data === "object" && "serviceErrorCode" in data
            ? Number((data as Record<string, unknown>).serviceErrorCode)
            : undefined;
        const message =
          (data && typeof data === "object" && "message" in data
            ? String((data as Record<string, unknown>).message)
            : text) || `LinkedIn API ${res.status}`;
        throw new LinkedInApiError(message, res.status, data ?? text, serviceErrorCode);
      }

      const restliId = res.headers.get("x-restli-id") ?? undefined;

      // Journal writes (best-effort). A logging failure must never surface as a
      // failed API call, so swallow everything the hook might throw or reject.
      if (this.onMutation && method !== "GET") {
        try {
          await this.onMutation({ method, path: opts.path, query: opts.query, headers: opts.headers, body: opts.body, status: res.status, restliId });
        } catch {
          /* change journaling is non-critical */
        }
      }

      return {
        data: data as T,
        status: res.status,
        restliId,
        headers: res.headers,
      };
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
