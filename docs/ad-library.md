---
title: Ad library collectors
description: "Collect ads from the LinkedIn, Google, Meta and TikTok public ad libraries, rank them only against comparable evidence, and write records for review."
order: 23
---

`adwarp library` reads the public ad libraries of LinkedIn, Google, Meta and TikTok for a list of advertisers, ranks what it finds only against ads with the same kind of evidence, and writes the shortlist as review-ready records. It powers the ad library on adwarp.dev, and works for any watchlist of your own.

It reads public transparency data only. It never touches an ad account, and it never reads the credentials Adwarp uses for your ad accounts.

## Credentials

Each platform needs access of its own, set as environment variables. The collector reads only the `ADWARP_LIBRARY_*` names below. It never falls back to `ADWARP_LINKEDIN_*`, `ADWARP_GOOGLE_*`, their older names or the files in `~/.adwarp`, because those usually hold the app that manages an employer's ad accounts. A missing variable stops the run with the names to set.

| Platform | Variables | Where they come from |
| --- | --- | --- |
| LinkedIn | `ADWARP_LIBRARY_LINKEDIN_ACCESS_TOKEN`, or `ADWARP_LIBRARY_LINKEDIN_CLIENT_ID`, `ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET` and `ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN` | A LinkedIn developer app owned by your own project's Page, with the LinkedIn Ad Library product approved |
| Google | `ADWARP_LIBRARY_GOOGLE_PROJECT`, `ADWARP_LIBRARY_GOOGLE_ACCESS_TOKEN` | A Google Cloud project you own, billed for BigQuery; the token from `gcloud auth print-access-token` |
| Meta | `ADWARP_LIBRARY_META_ACCESS_TOKEN` (optional `ADWARP_LIBRARY_META_API_VERSION`, `v25.0` otherwise) | A Meta developer app that finished identity confirmation and Ad Library API access |
| TikTok | `ADWARP_LIBRARY_TIKTOK_CLIENT_KEY`, `ADWARP_LIBRARY_TIKTOK_CLIENT_SECRET` | An approved Commercial Content API research project on TikTok for Developers |

## Sources

| Platform | Source | Coverage | Ranking evidence | Copy and media |
| --- | --- | --- | --- | --- |
| LinkedIn | Ad Library API | Every ad since June 2023; dates and impressions only for ads served in the EU | Total impression band (`geography: "total"`), countries in `regions` | None. Read the ad on its Ad Library page |
| Google | Ads Transparency Center, BigQuery public dataset | Ads served in the European Economic Area and Turkey | Times shown, a lower and upper bound per region | None. Read the ad on its Transparency Center page |
| Meta | Ad Library API (`ads_archive`) | Commercial ads delivered in the EU or the UK in the last year | `eu_total_reach`, an estimate for the EU | The first version of the copy, word for word. No format or media |
| TikTok | Commercial Content API | Ads shown in the EU | Unique users, per queried country | None kept: video and image links are signed and expire |

TikTok's Top Ads list has no public API. Add those ads to the website by hand with `source.type` `tiktok-top-ads` and `route` `manual`.

## Watchlist

A JSON file of advertisers with each platform's own ID for them. An entry without an ID for a platform is skipped there, because a name search also returns lookalike advertisers (a search for Vanta returns VantageScore). See the [example watchlist](https://github.com/adwarp-dev/adwarp/blob/main/examples/ad-library-watchlist.json).

| Field | Meaning |
| --- | --- |
| `category` | The category every ad falls under, such as `B2B SaaS`. An entry can set its own |
| `countries` | Country codes per platform. Meta and TikTok need at least 1; Google takes region codes such as `DE` or `EEA` |
| `linkedin.companyId` | The number in the advertiser's LinkedIn company URL. `searchName` overrides the name searched |
| `google.advertiserIds` | IDs starting with `AR`, from the advertiser's Transparency Center URL, or `disclosedName` |
| `meta.pageIds` | Facebook Page IDs, up to 10 per advertiser |
| `tiktok.businessIds` | TikTok business IDs. `searchTerm` overrides the name searched |

## Commands

```
adwarp library collect <platform> -w <watchlist.json> [-c <codes>] [-m <n>] [--days <n>] [--max-gib <n>] [-o <file>]
adwarp library drafts -i <candidates.json...> -t <content/ads> [--top <n>] [--per-advertiser <n>] [--ids <ids>] [--dry-run]
```

`collect` writes a candidates file: every ad it found, each number exactly as the source reported it, plus the advertisers it skipped and any that failed. 1 advertiser's failure never stops the others. `--max` is per advertiser (100), `--days` keeps Google and Meta ads shown in that many days, and TikTok ads published in them (365).

`drafts` ranks 1 or more candidates files together, prints the ranking, and writes the shortlist into a directory of records, 1 JSON file per ad. `--ids` adds ads as editor's picks even when they aren't ranked. `--dry-run` prints what it would write.

## Ranking

The ranking compares like with like and never adds numbers from different sources together.

- **Most seen:** ads with an exposure number (impressions, reach, times shown, unique users), grouped by platform, metric, region and period. Ranges that overlap count as level: an ad's position counts only the ads whose lowest value is above its highest.
- **Long running:** the other ads, when their dates show at least 30 days of running. Sorted by days run.
- Ads with neither are listed as unranked. They can still be added with `--ids`.
- After the evidence, the caps: at most 3 ads per advertiser (`--per-advertiser`), 1 ad per group of near-identical ads, and 25 in all (`--top`).

Every reason the ranking writes says what it was compared against, such as "100k-200k impressions in total, ranked 2 of 14 tracked LinkedIn ads with the same measure."

## Records

A new record starts as `media_pending`: the evidence is saved, but nobody has read the creative and there is no write-up. An editor reads the ad on its source page, writes the write-up and sets the status. Running the collector again later updates only what it owns:

| The collector updates | The editor owns |
| --- | --- |
| `source`, `advertiser.platformId`, `evidence` (and adds to `evidence.observations`), `copy` while it is still empty | `status`, `selection`, `writeup`, `creative`, `review`, `category`, `format`, the advertiser's name |

Every file is checked against the record rules before it is written. A file that doesn't pass, or an update that would break a rule (a most-seen pick whose impression number disappeared, for example), is reported and left as it was. Nothing is ever deleted.

## Cost

LinkedIn, Meta and TikTok charge nothing for these APIs. Google's dataset is billed to your Cloud project by the bytes a query scans: every run sends 1 query for the whole watchlist, runs it as a dry run first, and stops when the estimate passes `--max-gib` (20). The real query carries the same limit, so BigQuery itself refuses to scan more.
