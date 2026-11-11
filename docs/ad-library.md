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
| LinkedIn | Ad Library API | Every ad since June 2023, newest first, 25 a page; dates and impressions only for ads served in the EU | Total impression band (`geography: "total"`), countries in `regions` | None. Read the ad on its Ad Library page |
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
adwarp library collect <platform> -w <watchlist.json> [-c <codes>] [-m <n>] [--days <n>] [--max-gib <n>] [-o <file>] [--previous <file>] [--no-incremental] [--walk-back] [--months <n>] [--window-cap <n>] [--force] [--daily-calls <n>]
adwarp library drafts -i <candidates.json...> -t <content/ads> [--rank-by evidence|run] [--top <n>] [--per-advertiser <n>] [--ids <ids>] [--dry-run]
```

`collect` writes a candidates file: every ad it found, each number exactly as the source reported it, plus the advertisers it skipped and any that failed. 1 advertiser's failure never stops the others. `--max` is per advertiser (100), `--days` keeps Google and Meta ads shown in that many days, and TikTok ads published in them (365).

`drafts` ranks 1 or more candidates files together, prints the ranking, and writes the shortlist into a directory of records, 1 JSON file per ad. `--rank-by run` ranks by days run alone (see Ranking). `--ids` adds ads as editor's picks even when they aren't ranked. `--dry-run` prints what it would write.

## Long runners on LinkedIn

LinkedIn's Ad Library API returns an advertiser's newest ads first, 25 a page. Reaching an ad that started months ago and still runs means paging past every newer one: a pull of Ramp's newest 200 ads on November 11, 2026 returned 194, every one first shown between November 5 and 11. With the default `--max` of 100, the long-running ranking only covers each advertiser's newest ads.

`--walk-back` asks for 1 calendar month at a time instead, with LinkedIn's `dateRange` filter. LinkedIn doesn't document it (Microsoft Learn has no page for the Ad Library API), but live read-only checks on November 11, 2026 confirmed how it behaves, in the shape the reporting API uses, `(start:(year:2026,month:2,day:1),end:(year:2026,month:2,day:28))`:

- **It lists the ads served during the range, not the ads created in it.** Ramp's total fell from 13,081 to 3,701 for February 2026, and the same AirPods ads came back in every month from April to October.
- **It reaches back about 12 months.** On November 11, 2026, every month of 2025 before December returned nothing, so `--months` (12) can't go further.
- **A range that ends today or later returns nothing.** Nov 1 to 10 returned 213 ads and Nov 1 to 11, that day, returned none. The newest window always ends yesterday, and Adwarp refuses to send one that doesn't.
- **It works for ads never served in the EU.** Those carry no run dates or impressions, so the months the filter lists them in are the only run evidence LinkedIn gives for them.

So the walk asks for this month up to yesterday, then each whole month before it, newest first. Each window ends on its own last day: it isn't known whether LinkedIn's end is inclusive, so at worst a month's last day is missed, and an ad is never credited to a month it may not have run in. Every ad is kept once, with the months it was served in (`servedMonths` in the candidates file). The first of those months is a floor when it is the oldest month the walk asked about, because the filter reaches no further, or when an earlier month wasn't read in full (`servedMonthsFloor`).

A month with more ads than `--window-cap` (1000) is split in half until each part fits, and a single day that is still full is reported, because it may hold more. Served-during means a busy advertiser's month holds every ad that ran in it, long runners included (Ramp's February held 3,701), so `--max` rises to 20000 and a year of a busy advertiser takes thousands of 25-ad pages. Run it weekly or once, and the daily pull without it.

The walk still checks LinkedIn's answers: a dated ad whose run doesn't touch the window it came back in, or a 4xx on the first window, stops it with an error. Without `--walk-back`, a higher `--max`, such as 3000, pages deeper through the newest-first list instead.

With `--previous`, a walk that stops (the daily budget, or a 429) records the windows it didn't read, and the next `--walk-back` run with the same file resumes there and adds the months up. An advertiser whose walk finished in the last 7 days is skipped, keeping its ads, unless `--force`, which also starts a walk over instead of resuming. Both read `walks` in the candidates file, so pass the same file as `--previous` and `-o`.

## Staying within LinkedIn's limits

LinkedIn's limits are per app, per endpoint and per day. They aren't published, they reset at midnight UTC, and a call over the limit gets a 429. LinkedIn emails the app's admins at 75% of the daily quota, and the Developer Portal's Analytics tab shows the Ad Library's limit once the app has called it that day ([LinkedIn's rate limits page](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits)). A day of about 270 calls at the 2.2 second pace drew no throttling on November 11, 2026. Every Ad Library call, from `adwarp library` and from the `inspect_competitor_ads` tool and `adwarp competitor ads`, follows these rules:

| Rule | What happens |
| --- | --- |
| Pace | At least 2.2 seconds between calls, plus up to 0.6 seconds of jitter, across every search in a process |
| Daily budget | 300 calls a day per app for `adwarp library` (`--daily-calls` or `ADWARP_LIBRARY_LINKEDIN_DAILY_CALLS`), 150 for the tool and `adwarp competitor ads` (`ADWARP_AD_LIBRARY_DAILY_CALLS`). A call over it isn't sent: the run stops and says how many calls are left (0) and when the day resets |
| 429 | Waited out once per run, only with a `Retry-After` of 2 minutes or less. A second 429, or 1 without `Retry-After`, stops the run: the quota is likely spent until midnight UTC |
| 401, 403 | Stops at once, with no retry: the token is invalid or revoked, or the app isn't approved for the Ad Library product |
| Server error | Retried once, after the pace delay |

A stopped run keeps every ad it read. In `adwarp library collect`, the advertisers it didn't reach are listed as not reached and keep their ads from `--previous`, and the command exits with 1. Each run prints the calls it made and how many are left today.

The count is kept per app, by a hash of the client ID (never the ID itself or a token), and per UTC day, in `~/.local/state/adwarp/ad-library` (or `$XDG_STATE_HOME/adwarp/ad-library`, or `ADWARP_AD_LIBRARY_STATE_DIR`), so every run and process on the machine shares it. It never touches the credential files in `~/.adwarp`. With only an access token, `adwarp library` counts under 1 shared key unless `ADWARP_LIBRARY_LINKEDIN_CLIENT_ID` is set too.

Daily runs are cheap: with `--previous`, `collect` reads each advertiser newest first and stops at the first full page of 25 that holds none of its ads the last run didn't have, so a check costs about 1 or 2 calls per advertiser. `--no-incremental` reads up to `--max` instead. Walks are the expensive part: run them weekly at most, and check the Analytics tab after the first one.

## New ads and alerts

`--previous <file>` compares the run with the last one and lists the ads that are new since then, per advertiser, with format, first shown date and link. It can be the same path as `--out`: the last run is read before the new one is written. With no file at that path, the run is the baseline.

| An ad that wasn't in the last run | Counts as |
| --- | --- |
| From an advertiser the last run pulled, first shown on or after the day before it (or with no date) | New, in the alert |
| First shown earlier, such as an older ad a bigger `--max` reached | Found late, listed only |
| From an advertiser added to the watchlist since | The baseline for that advertiser, no alert |

An advertiser that fails in a run keeps its ads from the last run, so a 1-day outage doesn't make all its ads new the day after. When every ad pulled for an advertiser is new and the pull hit `--max`, the alert says there may be more.

The comparison is saved in the new file under `changes`, and printed. When `ADWARP_LIBRARY_ALERT_WEBHOOK` is set and something launched, the summary is also posted to it as `{"text": "..."}`, which is what a Slack incoming webhook takes. Nothing is posted when nothing is new. The message holds only advertiser names, formats, dates and public ad links, and an error never prints the webhook URL.

```
Adwarp ad library: 3 new LinkedIn ads from 2 advertisers since Nov 10, 2026.

Ramp: 2 new
- single image, first shown Nov 11, 2026: https://www.linkedin.com/ad-library/detail/1610000001
- video, first shown Nov 10, 2026: https://www.linkedin.com/ad-library/detail/1610000002

Rippling: 1 new
- document, no first shown date: https://www.linkedin.com/ad-library/detail/1610000003
```

## Daily schedule

The commands need a release of the `adwarp` package that includes `adwarp library`; until then, run them from a checkout (`pnpm -r build`, then `node packages/adwarp/dist/cli.js library ...`). The examples keep 1 state file per platform and pass it as both `--previous` and `--out`.

With cron, from a folder that holds `watchlist.json` and a `library.env` file with the `ADWARP_LIBRARY_*` variables:

```bash
# Every day at 7:00
0 7 * * * cd ~/ad-watch && set -a && . ./library.env && set +a && for p in linkedin meta; do npx -y adwarp library collect "$p" -w watchlist.json --previous "state-$p.json" -o "state-$p.json"; done >> watch.log 2>&1
```

With GitHub Actions, in a private repository that holds `watchlist.json`, with the variables saved as repository secrets. The cache carries the state files from 1 run to the next. This is an example to copy; the Adwarp repository doesn't run it.

```yaml .github/workflows/ad-watch.yml
name: Ad watch
on:
  schedule:
    - cron: "0 7 * * *"
  workflow_dispatch:

jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Restore the last run
        uses: actions/cache/restore@v4
        with:
          path: state
          key: ad-watch-${{ github.run_id }}
          restore-keys: ad-watch-
      - name: Collect and alert
        env:
          ADWARP_LIBRARY_LINKEDIN_CLIENT_ID: ${{ secrets.ADWARP_LIBRARY_LINKEDIN_CLIENT_ID }}
          ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET: ${{ secrets.ADWARP_LIBRARY_LINKEDIN_CLIENT_SECRET }}
          ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN: ${{ secrets.ADWARP_LIBRARY_LINKEDIN_REFRESH_TOKEN }}
          ADWARP_LIBRARY_META_ACCESS_TOKEN: ${{ secrets.ADWARP_LIBRARY_META_ACCESS_TOKEN }}
          ADWARP_LIBRARY_ALERT_WEBHOOK: ${{ secrets.ADWARP_LIBRARY_ALERT_WEBHOOK }}
        run: |
          mkdir -p state
          status=0
          for p in linkedin meta; do
            npx -y adwarp library collect "$p" -w watchlist.json --previous "state/$p.json" -o "state/$p.json" || status=1
          done
          exit $status
      - name: Save this run
        if: always()
        uses: actions/cache/save@v4
        with:
          path: state
          key: ad-watch-${{ github.run_id }}
```

A step that fails still saves the state, and the next run picks up from it. LinkedIn refresh tokens and Meta tokens expire, so a run that starts failing on credentials needs new secrets.

## Ranking

The ranking compares like with like and never adds numbers from different sources together.

- **Most seen:** ads with an exposure number (impressions, reach, times shown, unique users), grouped by platform, metric, region and period. Ranges that overlap count as level: an ad's position counts only the ads whose lowest value is above its highest.
- **Long running:** the other ads, when their dates show at least 30 days of running. Sorted by days run.
- Ads with neither are listed as unranked. They can still be added with `--ids`.
- **`--rank-by run`** ranks every ad by days run alone, exposure numbers aside, from its run dates or, for a LinkedIn ad with no EU dates, from its served months. Months give a minimum: from the last day of the first month to the first day of the last, because served-during names no day inside a month. Ads under 30 days are left out.
- After the evidence, the caps: at most 3 ads per advertiser (`--per-advertiser`), 1 ad per group of near-identical ads, and 25 in all (`--top`).

Every reason the ranking writes says what it was compared against, such as "100k-200k impressions in total, ranked 2 of 14 tracked LinkedIn ads with the same measure." A run from served months says where it comes from: "Ran at least 275 days: LinkedIn's date filter lists it as served in 11 months, Dec 2025 to Oct 2026, and Dec 2025 is a floor because the filter reaches back only 12 months, ranked 1 of 3 tracked LinkedIn ads by days run."

The website's record format has no field for served months yet, so `drafts` prints those ads in the ranking but doesn't write them as records.

## Records

A new record starts as `media_pending`: the evidence is saved, but nobody has read the creative and there is no write-up. An editor reads the ad on its source page, writes the write-up and sets the status. Running the collector again later updates only what it owns:

| The collector updates | The editor owns |
| --- | --- |
| `source`, `advertiser.platformId`, `evidence` (and adds to `evidence.observations`), `copy` while it is still empty | `status`, `selection`, `writeup`, `creative`, `review`, `category`, `format`, the advertiser's name |

Every file is checked against the record rules before it is written. A file that doesn't pass, or an update that would break a rule (a most-seen pick whose impression number disappeared, for example), is reported and left as it was. Nothing is ever deleted.

## Cost

LinkedIn, Meta and TikTok charge nothing for these APIs. Google's dataset is billed to your Cloud project by the bytes a query scans: every run sends 1 query for the whole watchlist, runs it as a dry run first, and stops when the estimate passes `--max-gib` (20). The real query carries the same limit, so BigQuery itself refuses to scan more.
