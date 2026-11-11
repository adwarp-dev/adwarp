import type { AdMetric, AdMetricName } from "./record.js";

/** The 27 EU member states, as ISO 3166-1 alpha-2 codes. */
export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

const EU = new Set<string>(EU_COUNTRIES);
export const isEuCountry = (code: string): boolean => EU.has(code.toUpperCase());

/** Today as YYYY-MM-DD in UTC, or the given date's day. */
export function isoDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** "2026-09-09T07:00:00+0000", "2026-09-09" or an epoch in ms to YYYY-MM-DD; anything else to null. */
export function toDay(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString().slice(0, 10);
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** TikTok's compact dates: 20210101 (number or string) to 2021-01-01. */
export function compactToDay(value: unknown): string | null {
  const s = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const SUFFIX: Record<string, number> = { "": 1, K: 1_000, M: 1_000_000, B: 1_000_000_000 };

/** "11K" to 11000, "1.5M" to 1500000, "1,000" to 1000. Undefined when it isn't 1 count. */
export function parseCount(text: string): number | undefined {
  const m = text.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([KMB]?)$/i);
  if (!m) return undefined;
  const factor = SUFFIX[(m[2] ?? "").toUpperCase()];
  if (factor === undefined) return undefined;
  return Math.round(Number(m[1]) * factor);
}

export interface MetricScope {
  geography: string;
  period: string;
  source: string;
  collectedAt: string;
}

/**
 * Turns a count the source printed as text into a metric, keeping the text as it was:
 * - "0-1K" and "10K-100K" become a range with both bounds.
 * - "100K+" becomes a range with only a lower bound.
 * - "11K" becomes kind estimate with value 11000: the source rounded it, and `text` keeps "11K" so the page
 *   shows the source's own wording. A plain integer such as "1234" is exact.
 * - Anything else becomes a relative metric with only its words, so it can never be ranked as a number.
 * Empty text returns undefined: an unreported metric is left out, never 0.
 */
export function countMetric(name: AdMetricName, text: unknown, scope: MetricScope): AdMetric | undefined {
  if (typeof text !== "string" && typeof text !== "number") return undefined;
  const raw = String(text).trim();
  if (!raw) return undefined;
  const base = { name, text: raw, ...scope };
  const range = raw.match(/^(.+?)\s*-\s*(.+)$/);
  if (range) {
    const lower = parseCount(range[1] ?? "");
    const upper = parseCount(range[2] ?? "");
    if (lower !== undefined && upper !== undefined && upper >= lower) return { ...base, kind: "range", lower, upper };
  }
  const open = raw.match(/^(.+?)\s*\+$/);
  if (open) {
    const lower = parseCount(open[1] ?? "");
    if (lower !== undefined) return { ...base, kind: "range", lower };
  }
  const value = parseCount(raw);
  if (value !== undefined) return { ...base, kind: /^\d+$/.test(raw.replace(/,/g, "")) ? "exact" : "estimate", value };
  return { ...base, kind: "relative" };
}

/** Lowercase words joined by hyphens: "monday.com" to "monday-com". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A URL without its query string and fragment, for fingerprinting signed media URLs. */
export function stripQuery(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

/** The host of a URL without "www.", for a display URL. Undefined when it isn't a URL. */
export function hostOf(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
