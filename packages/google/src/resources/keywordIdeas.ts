import type { GoogleAdsClient } from "../http.js";
import { fromMicros } from "../mutate.js";
import { resolveGeoTarget, resolveLanguage } from "./constants.js";

export interface KeywordIdea {
  text: string;
  /** Rounded monthly search volume. Google returns a banded estimate, not a count. */
  avgMonthlySearches: number;
  /** LOW | MEDIUM | HIGH, or UNSPECIFIED when there is too little data. */
  competition: string;
  /** 0-100. More granular than the band. */
  competitionIndex: number;
  /** Top-of-page bid range, in account currency. */
  lowTopOfPageBid: number;
  highTopOfPageBid: number;
}

/**
 * Keyword research: volume, competition, and top-of-page bid range for seed
 * terms and/or a landing page. This is the Google analog of Adwarp's targeting
 * search plus audience estimate — the sizing you do before committing budget.
 */
export async function generateKeywordIdeas(
  client: GoogleAdsClient,
  customerId: string,
  opts: { seeds: string[]; pageUrl?: string; locations: string[]; languages: string[]; limit: number },
): Promise<KeywordIdea[]> {
  const geoTargetConstants = await Promise.all(
    opts.locations.map((l) => resolveGeoTarget(client, customerId, l)),
  );
  // The request takes exactly one language, unlike locations.
  const language = await resolveLanguage(client, customerId, opts.languages[0] ?? "en");

  const seeds = opts.seeds.filter(Boolean);
  const body: Record<string, unknown> = {
    language,
    geoTargetConstants,
    includeAdultKeywords: false,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };
  // The seed field name encodes which inputs were supplied; sending the wrong
  // one for the inputs is an invalid-argument error.
  if (seeds.length && opts.pageUrl) body.keywordAndUrlSeed = { url: opts.pageUrl, keywords: seeds };
  else if (opts.pageUrl) body.urlSeed = { url: opts.pageUrl };
  else body.keywordSeed = { keywords: seeds };

  const res = await client.request<{ results?: any[] }>({
    method: "POST",
    path: `/customers/${customerId}:generateKeywordIdeas`,
    body,
    isRead: true,
  });

  return (res.results ?? [])
    .map((r): KeywordIdea => {
      const m = r.keywordIdeaMetrics ?? {};
      return {
        text: r.text ?? "",
        avgMonthlySearches: Number(m.avgMonthlySearches ?? 0),
        competition: m.competition ?? "UNSPECIFIED",
        competitionIndex: Number(m.competitionIndex ?? 0),
        lowTopOfPageBid: m.lowTopOfPageBidMicros ? fromMicros(m.lowTopOfPageBidMicros) : 0,
        highTopOfPageBid: m.highTopOfPageBidMicros ? fromMicros(m.highTopOfPageBidMicros) : 0,
      };
    })
    .sort((a, b) => b.avgMonthlySearches - a.avgMonthlySearches)
    .slice(0, opts.limit);
}
