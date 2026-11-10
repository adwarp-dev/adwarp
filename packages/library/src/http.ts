import { DEFAULT_MAX_RETRIES, isRetryableStatus, retryDelayMs, sleep, transportRetryDelayMs } from "@adwarp/shared";
import type { FetchLike } from "./types.js";

export class LibraryApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "LibraryApiError";
  }
}

/** Strips tokens and secrets from a URL before it goes into an error message or a log line. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()])
      if (/token|secret|key|signature/i.test(key)) u.searchParams.set(key, "REDACTED");
    return u.toString();
  } catch {
    return "(unparseable URL)";
  }
}

/**
 * Quotes integer values of the named keys before JSON.parse, so 64-bit IDs (TikTok sends ad and business IDs as
 * bare numbers) never lose their last digits to floating point.
 */
export function quoteBigIds(text: string, keys: string[]): string {
  if (!keys.length) return text;
  const pattern = new RegExp(`("(?:${keys.join("|")})"\\s*:\\s*)(-?\\d{15,})`, "g");
  return text.replace(pattern, '$1"$2"');
}

export interface RequestJsonOptions {
  /** Shown in errors: "Meta Ad Library", "TikTok Commercial Content API". */
  name: string;
  /** Keys whose integer values must stay exact (see quoteBigIds). */
  bigIdKeys?: string[];
  maxRetries?: number;
  /** Tests pass 0 to skip real waiting. */
  delayScale?: number;
}

/** 1 JSON request with the repo's shared retry policy: retries 429 and 5xx, never other client errors. */
export async function requestJson<T>(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  opts: RequestJsonOptions,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const scale = opts.delayScale ?? 1;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await sleep(transportRetryDelayMs(attempt) * scale);
        continue;
      }
      throw new Error(`${opts.name}: request to ${redactUrl(url)} failed: ${(err as Error)?.message ?? String(err)}`);
    }
    if (isRetryableStatus(res.status) && attempt < maxRetries) {
      await sleep(retryDelayMs(attempt, res.headers.get("retry-after")) * scale);
      continue;
    }
    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(quoteBigIds(text, opts.bigIdKeys ?? []));
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const detail = typeof data === "object" && data !== null ? JSON.stringify(data).slice(0, 500) : String(text).slice(0, 500);
      throw new LibraryApiError(`${opts.name} answered ${res.status} for ${redactUrl(url)}: ${detail}`, res.status, data);
    }
    return data as T;
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${opts.name}: request failed`);
}
