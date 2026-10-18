import type { GoogleAdsClient } from "../http.js";
import { search } from "../gaql.js";
import { fromMicros } from "../mutate.js";

export interface GoogleCampaignSummary {
  id: string;
  name: string;
  status: string;
  channelType: string;
  dailyBudget: number;
  biddingStrategyType?: string;
  startDate?: string;
  endDate?: string;
  adGroups?: GoogleAdGroupSummary[];
}

export interface GoogleAdGroupSummary {
  id: string;
  name: string;
  status: string;
  campaignId: string;
  cpcBid: number;
}

/**
 * Account structure: campaigns with their ad groups nested, drafts and paused
 * included. The rough equivalent of `adwarp campaigns list`.
 */
export async function listCampaigns(
  client: GoogleAdsClient,
  customerId: string,
  opts: { includeRemoved?: boolean } = {},
): Promise<GoogleCampaignSummary[]> {
  const statusFilter = opts.includeRemoved ? "" : "WHERE campaign.status != 'REMOVED'";
  const rows = await search(
    client,
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
            campaign.bidding_strategy_type, campaign.start_date_time, campaign.end_date_time,
            campaign_budget.amount_micros
     FROM campaign ${statusFilter}
     ORDER BY campaign.name`,
  );

  const campaigns: GoogleCampaignSummary[] = rows.map((r) => ({
    id: String(r.campaign?.id ?? ""),
    name: r.campaign?.name ?? "",
    status: r.campaign?.status ?? "",
    channelType: r.campaign?.advertisingChannelType ?? "",
    dailyBudget: r.campaignBudget?.amountMicros ? fromMicros(r.campaignBudget.amountMicros) : 0,
    biddingStrategyType: r.campaign?.biddingStrategyType,
    startDate: r.campaign?.startDateTime,
    endDate: r.campaign?.endDateTime,
    adGroups: [],
  }));

  const adGroups = await listAdGroups(client, customerId, { includeRemoved: opts.includeRemoved });
  const byCampaign = new Map(campaigns.map((c) => [c.id, c]));
  for (const g of adGroups) byCampaign.get(g.campaignId)?.adGroups?.push(g);

  return campaigns;
}

export async function listAdGroups(
  client: GoogleAdsClient,
  customerId: string,
  opts: { campaignId?: string; includeRemoved?: boolean } = {},
): Promise<GoogleAdGroupSummary[]> {
  const filters = [opts.includeRemoved ? "" : "ad_group.status != 'REMOVED'"];
  if (opts.campaignId) filters.push(`campaign.id = ${opts.campaignId}`);
  const where = filters.filter(Boolean).join(" AND ");

  const rows = await search(
    client,
    customerId,
    `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, campaign.id
     FROM ad_group ${where ? `WHERE ${where}` : ""}
     ORDER BY ad_group.name`,
  );
  return rows.map((r) => ({
    id: String(r.adGroup?.id ?? ""),
    name: r.adGroup?.name ?? "",
    status: r.adGroup?.status ?? "",
    campaignId: String(r.campaign?.id ?? ""),
    cpcBid: r.adGroup?.cpcBidMicros ? fromMicros(r.adGroup.cpcBidMicros) : 0,
  }));
}

export interface GoogleAdSummary {
  id: string;
  adGroupId: string;
  status: string;
  type: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
}

/** Ads in an ad group (or across the account), with their responsive-search copy. */
export async function listAds(
  client: GoogleAdsClient,
  customerId: string,
  opts: { adGroupId?: string; includeRemoved?: boolean } = {},
): Promise<GoogleAdSummary[]> {
  const filters = [opts.includeRemoved ? "" : "ad_group_ad.status != 'REMOVED'"];
  if (opts.adGroupId) filters.push(`ad_group.id = ${opts.adGroupId}`);
  const where = filters.filter(Boolean).join(" AND ");

  const rows = await search(
    client,
    customerId,
    `SELECT ad_group_ad.ad.id, ad_group_ad.status, ad_group_ad.ad.type,
            ad_group_ad.ad.responsive_search_ad.headlines,
            ad_group_ad.ad.responsive_search_ad.descriptions,
            ad_group_ad.ad.final_urls, ad_group.id
     FROM ad_group_ad ${where ? `WHERE ${where}` : ""}`,
  );
  return rows.map((r) => {
    const ad = r.adGroupAd?.ad ?? {};
    return {
      id: String(ad.id ?? ""),
      adGroupId: String(r.adGroup?.id ?? ""),
      status: r.adGroupAd?.status ?? "",
      type: ad.type ?? "",
      headlines: (ad.responsiveSearchAd?.headlines ?? []).map((h: any) => h.text ?? ""),
      descriptions: (ad.responsiveSearchAd?.descriptions ?? []).map((d: any) => d.text ?? ""),
      finalUrls: ad.finalUrls ?? [],
    };
  });
}
