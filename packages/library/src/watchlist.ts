import { AD_PLATFORMS, type AdPlatform } from "./record.js";

/**
 * The advertisers a collection run searches. 1 entry per brand, with each platform's own identifier for it. An
 * entry without an identifier for a platform is skipped on that platform rather than searched by a loose name:
 * name searches return partners and lookalike advertisers (a search for Vanta also returns VantageScore).
 */
export interface WatchlistEntry {
  /** The brand as the library shows it. */
  name: string;
  domain?: string;
  /** Overrides the watchlist's category for this brand. */
  category?: string;
  /** LinkedIn: the API searches by advertiser name, then the numeric company ID filters the results. */
  linkedin?: { companyId?: string; searchName?: string };
  /** Google Ads Transparency Center advertiser IDs (AR followed by digits), or the exact disclosed name. */
  google?: { advertiserIds?: string[]; disclosedName?: string };
  /** Facebook Page IDs. The Ad Library API takes up to 10 per request. */
  meta?: { pageIds?: string[] };
  /** TikTok business IDs. The API searches ad text, so results are kept only when the business ID matches. */
  tiktok?: { businessIds?: string[]; searchTerm?: string };
}

export interface Watchlist {
  version: 1;
  /** The category every entry falls under unless it sets its own, such as "B2B SaaS". */
  category: string;
  /** A note on the intended scope, such as "US and EU". Shown in the candidates file, not used for filtering. */
  scope?: string;
  /** Default country filters per platform. `--country` on the command line replaces them. */
  countries?: Partial<Record<AdPlatform, string[]>>;
  advertisers: WatchlistEntry[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** Checks a parsed watchlist file and returns it typed, or throws listing every problem. */
export function parseWatchlist(raw: unknown): Watchlist {
  const problems: string[] = [];
  if (!isObject(raw)) throw new Error("The watchlist must be a JSON object.");
  if (raw.version !== 1) problems.push("version must be 1");
  if (typeof raw.category !== "string" || !raw.category.trim()) problems.push("category is required");
  if (raw.countries !== undefined) {
    if (!isObject(raw.countries)) problems.push("countries must map a platform to a list of country codes");
    else
      for (const [platform, list] of Object.entries(raw.countries)) {
        if (!(AD_PLATFORMS as readonly string[]).includes(platform)) problems.push(`countries.${platform} is not a platform`);
        if (!isStringList(list) || !list.every((c) => /^[A-Za-z]{2,3}$/.test(c)))
          problems.push(`countries.${platform} must be a list of country codes such as "DE"`);
      }
  }
  if (!Array.isArray(raw.advertisers) || raw.advertisers.length === 0) problems.push("advertisers must be a non-empty list");
  else {
    const seen = new Set<string>();
    raw.advertisers.forEach((entry, i) => {
      const at = `advertisers[${i}]`;
      if (!isObject(entry) || typeof entry.name !== "string" || !entry.name.trim()) {
        problems.push(`${at}.name is required`);
        return;
      }
      const key = entry.name.toLowerCase();
      if (seen.has(key)) problems.push(`${at}: ${entry.name} is listed twice`);
      seen.add(key);
      const li = entry.linkedin;
      if (li !== undefined && (!isObject(li) || (li.companyId !== undefined && !/^\d+$/.test(String(li.companyId)))))
        problems.push(`${at}.linkedin.companyId must be digits`);
      const g = entry.google;
      if (g !== undefined && (!isObject(g) || (g.advertiserIds !== undefined && !isStringList(g.advertiserIds))))
        problems.push(`${at}.google.advertiserIds must be a list`);
      if (isObject(g) && isStringList(g.advertiserIds) && !g.advertiserIds.every((id) => /^AR\d+$/.test(id)))
        problems.push(`${at}.google.advertiserIds look like AR followed by digits`);
      const m = entry.meta;
      if (m !== undefined && (!isObject(m) || (m.pageIds !== undefined && !(isStringList(m.pageIds) && m.pageIds.every((id) => /^\d+$/.test(id))))))
        problems.push(`${at}.meta.pageIds must be a list of digit strings`);
      const t = entry.tiktok;
      if (t !== undefined && (!isObject(t) || (t.businessIds !== undefined && !(isStringList(t.businessIds) && t.businessIds.every((id) => /^\d+$/.test(id))))))
        problems.push(`${at}.tiktok.businessIds must be a list of digit strings`);
    });
  }
  if (problems.length) throw new Error(`The watchlist has problems:\n  - ${problems.join("\n  - ")}`);
  return raw as unknown as Watchlist;
}
