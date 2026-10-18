/** Official API discovery plus optional remote creative collection. Never opens a local browser. */
import type { AdLibraryScanOptions, AdLibraryAd } from "./adLibrary.js";
import { searchAdLibraryApi } from "./adLibraryApi.js";
import { creativeWorkerConfig, getRemoteCreatives } from "./remoteCreatives.js";

export type CompetitorAdsEngine = "auto" | "api" | "scraper";
export interface CompetitorAdsOptions extends AdLibraryScanOptions { engine?: CompetitorAdsEngine }
export interface CompetitorAdsResult {
  engine: "api";
  note?: string;
  query: { advertiser?: string; companyId?: string; keyword?: string; countries?: string[] };
  totalReported?: number;
  fetched: number;
  ads: AdLibraryAd[];
}

export async function scanCompetitorAds(opts: CompetitorAdsOptions): Promise<CompetitorAdsResult> {
  if (opts.engine === "scraper") throw new Error("Local scraper mode has been removed. Use auto for API discovery plus the remote creative worker.");
  if (!opts.advertiser && !opts.keyword) throw new Error("Provide an advertiser name with companyId. The official API needs a name; companyId filters its results. Local scraping is disabled.");
  if (opts.companyId && !/^\d+$/.test(opts.companyId)) throw new Error("companyId must be numeric.");
  if (opts.max !== undefined && (!Number.isInteger(opts.max) || opts.max < 1 || opts.max > 500)) throw new Error("max must be an integer from 1 to 500.");
  if (opts.copyMax !== undefined && (!Number.isInteger(opts.copyMax) || opts.copyMax < 0 || opts.copyMax > 10)) throw new Error("copyMax must be an integer from 0 to 10.");
  const { createLinkedInAds } = await import("./client.js");
  const linkedinAds = await createLinkedInAds();
  // API errors propagate. They must never trigger a browser fallback.
  const result = await searchAdLibraryApi(linkedinAds.client, opts);
  const ads = opts.companyId ? result.ads.filter(ad =>
    ad.detail?.advertiserUrl?.replace(/\/$/, "").endsWith(`/company/${opts.companyId}`)) : result.ads;
  const notes = [opts.companyId
    ? `Filtered ${result.fetched} API results to ${ads.length} ads for company ${opts.companyId}. Total reported is the broad API query total, not the exact company total.`
    : "Advertiser name searches can include unrelated companies. Supply companyId to filter before collecting creatives."];
  if (opts.engine !== "api" && opts.deep !== false && ads.length) {
    // Broad name matches never automatically schedule unrelated advertisers.
    if (!opts.companyId) notes.push("Creative collection requires companyId to verify the advertiser. API metadata only.");
    else {
      const limit = Math.min(10, Math.max(0, Math.floor(opts.copyMax ?? 10)));
      try {
        const remote = await getRemoteCreatives(ads.slice(0, limit).map(ad => ad.detailId), true);
        for (const creative of remote.creatives) {
          const ad = ads.find(a => a.detailId === creative.id);
          if (!ad) continue;
          ad.creativeStatus = creative.status;
          ad.collectedAt = creative.collectedAt;
          if (creative.copy) {
            ad.commentary = creative.copy.commentary;
            ad.imageUrl = creative.copy.imageUrl;
            ad.detail = { ...ad.detail, headline: creative.copy.headline, cta: creative.copy.cta };
            if (creative.copy.screenshotPath) ad.screenshotUrl = `${creativeWorkerConfig().base}/v1/creatives/${creative.id}/screenshot`;
          }
        }
        notes.push(`${remote.creatives.filter(c => c.status === "done").length}/${remote.creatives.length} sampled creatives ready. Pending jobs run on the remote worker; use get_competitor_creatives or creative-status to read them without another discovery request.`);
        if (remote.note) notes.push(remote.note);
        if (remote.blocked) notes.push("Worker blocked: collection disabled until operator review. Do not retry scraping.");
      } catch (e) { notes.push(e instanceof Error ? e.message : "Remote worker unavailable; metadata only."); }
    }
  } else notes.push("API metadata only; no browser requests.");
  return { engine: "api", query: { advertiser: opts.advertiser, companyId: opts.companyId, keyword: opts.keyword, countries: opts.countries },
    totalReported: result.totalReported, fetched: ads.length, ads, note: notes.join(" ") };
}
