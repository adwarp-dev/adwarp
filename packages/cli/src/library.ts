/**
 * `adwarp library`: collect ads from the public ad libraries (LinkedIn, Google, Meta, TikTok), rank them against
 * comparable evidence, and write review-ready records for the adwarp.dev ad library. See docs/ad-library.md.
 */
import { readFile, writeFile } from "node:fs/promises";
import {
  AD_PLATFORMS,
  type AdPlatform,
  type AdRecord,
  type Candidate,
  type CandidatesFile,
  changesSummary,
  collect,
  compareWithPrevious,
  newRecord,
  parseCandidatesFile,
  parseWatchlist,
  rankCandidates,
  sendAlert,
  writeDrafts,
} from "@adwarp/library";
import type { Command } from "commander";

const list = (value: string | undefined) =>
  value ? value.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
const int = (value: string) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Expected a whole number of 1 or more, got ${value}`);
  return n;
};

export function registerLibraryCommands(program: Command): void {
  const library = program
    .command("library")
    .description("Public ad libraries (LinkedIn, Google, Meta, TikTok): collect, rank and draft records for review");

  library
    .command("collect <platform>")
    .description(`Collect a watchlist's ads from 1 platform's public library (${AD_PLATFORMS.join(", ")}) into a candidates file`)
    .requiredOption("-w, --watchlist <file>", "Watchlist JSON: the advertisers and their IDs on each platform")
    .option("-c, --country <codes>", "Comma-separated country codes; replaces the watchlist's countries for this platform")
    .option("-m, --max <n>", "Ads per advertiser (100, or 20000 with --walk-back)", int)
    .option("--days <n>", "Only ads shown (Google, Meta) or published (TikTok) in the last n days", int, 365)
    .option("--max-gib <n>", "Google only: the most GiB BigQuery may scan (billed to your project)", int, 20)
    .option("-o, --out <file>", "Where to write the candidates file (default ad-library-<platform>-<date>.json)")
    .option("--walk-back", "LinkedIn only: read 1 calendar month at a time, back to --months, and record the months each ad was served in")
    .option("--months <n>", "Months for --walk-back, counting the current one (LinkedIn's filter reaches back 12)", int, 12)
    .option("--window-cap <n>", "Ads read per window before --walk-back splits it", int, 1000)
    .option("--previous <file>", "The last run's candidates file: report the ads that are new since then (can be the same path as --out)")
    .action(async (platform: string, opts) => {
      if (!(AD_PLATFORMS as readonly string[]).includes(platform))
        throw new Error(`Unknown platform ${platform}. Use ${AD_PLATFORMS.join(", ")}.`);
      const watchlist = parseWatchlist(JSON.parse(await readFile(opts.watchlist, "utf8")));
      // Read the previous run first: --previous and --out may be the same file.
      let previous: CandidatesFile | undefined;
      if (opts.previous) {
        try {
          previous = parseCandidatesFile(JSON.parse(await readFile(opts.previous, "utf8")));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          console.log(`No previous run at ${opts.previous}, so this run is the baseline.`);
        }
      }
      const collected = await collect({
        platform: platform as AdPlatform,
        watchlist,
        watchlistPath: opts.watchlist,
        ...(opts.country ? { countries: list(opts.country) } : {}),
        ...(opts.max ? { max: opts.max } : {}),
        ...(opts.walkBack ? { walkBack: { months: opts.months, windowCap: opts.windowCap } } : {}),
        days: opts.days,
        maxBytes: opts.maxGib * 1024 ** 3,
        onProgress: (m) => console.error(`… ${m}`),
      });
      const { file, report } = compareWithPrevious(previous, collected);
      const out = opts.out ?? `ad-library-${platform}-${file.collectedAt}.json`;
      await writeFile(out, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      console.log(`\n${file.candidates.length} ads from ${watchlist.advertisers.length - file.skipped.length} advertisers on ${platform}. Wrote ${out}.`);
      for (const s of file.skipped) console.log(`  skipped ${s.advertiser}: ${s.reason}`);
      for (const e of file.errors) console.log(`  failed  ${e.advertiser}: ${e.message}`);
      if (file.errors.length) process.exitCode = 1;
      if (report) {
        console.log(`\n${changesSummary(report)}`);
        try {
          const sent = await sendAlert(report);
          if (sent === "posted") console.log("\nAlert posted.");
          if (sent === "printed") console.log("\nADWARP_LIBRARY_ALERT_WEBHOOK isn't set, so the alert was only printed.");
        } catch (err) {
          console.error(`\n${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
    });

  library
    .command("drafts")
    .description("Rank collected ads and write the shortlist as records into the website's content/ads directory")
    .requiredOption("-i, --candidates <files...>", "Candidates files from `adwarp library collect`")
    .requiredOption("-t, --to <dir>", "The website's content/ads directory")
    .option("--top <n>", "Shortlist size", int, 25)
    .option("--per-advertiser <n>", "At most this many ads per advertiser", int, 3)
    .option("--ids <ids>", "Comma-separated ad IDs to add as editor's picks even when they aren't ranked")
    .option("--rank-by <how>", "evidence (most seen, then long running) or run (days run only, served months included)", "evidence")
    .option("--dry-run", "Print the ranking and the files it would write, without writing")
    .action(async (opts) => {
      // The newest observation of each ad wins when files overlap.
      const byKey = new Map<string, Candidate>();
      for (const path of opts.candidates as string[]) {
        const file = parseCandidatesFile(JSON.parse(await readFile(path, "utf8")));
        for (const c of file.candidates) {
          const key = `${c.platform} ${c.source.adId}`;
          const seen = byKey.get(key);
          if (!seen || seen.checkedAt <= c.checkedAt) byKey.set(key, c);
        }
      }
      const candidates = [...byKey.values()];
      if (opts.rankBy !== "evidence" && opts.rankBy !== "run") throw new Error(`--rank-by takes evidence or run, not ${opts.rankBy}`);
      const report = rankCandidates(candidates, { top: opts.top, perAdvertiser: opts.perAdvertiser, by: opts.rankBy });

      console.log(`\n${candidates.length} ads. ${report.shortlist.length} on the shortlist, ${report.leftOut} left out by the caps, ${report.ineligible.length} without ranking evidence.`);
      for (const g of report.groups) console.log(`  group ${g.group}: ${g.size}`);
      console.log("");
      report.shortlist.forEach((r, i) => {
        const c = r.candidate;
        console.log(`${String(i + 1).padStart(2)}. ${c.advertiser.name} ${c.platform} ${c.format} ${c.source.adId} [${r.collection}]`);
        console.log(`    ${r.reason}`);
      });

      // A run known only from served months can be ranked, but the record format has no field for that evidence yet.
      const fromMonths = report.shortlist.filter((r) => r.runFromMonths);
      const records: AdRecord[] = report.shortlist.filter((r) => !r.runFromMonths).map((r) => newRecord(r));
      if (fromMonths.length)
        console.log(
          `\n${fromMonths.length} ranked by served months only, not written: the website's record format has no field for served months yet (${fromMonths.map((r) => r.candidate.source.adId).join(", ")}).`,
        );
      const picked = new Set(report.shortlist.map((r) => r.candidate.source.adId));
      for (const id of list(opts.ids) ?? []) {
        if (picked.has(id)) continue;
        const c = candidates.find((x) => x.source.adId === id);
        if (!c) {
          console.log(`  --ids ${id}: not in the candidates files, skipped`);
          continue;
        }
        records.push(newRecord({ candidate: c, collection: "editors-pick", reason: "Added by an editor for the creative, not ranked by a metric." }));
      }

      const outcomes = await writeDrafts(records, { dir: opts.to, dryRun: Boolean(opts.dryRun) });
      console.log("");
      for (const o of outcomes)
        console.log(o.action === "skipped" ? `  skipped   ${o.slug}: ${o.reason}` : `  ${o.action.padEnd(9)} ${o.slug} (${o.status})`);
      if (opts.dryRun) console.log("\nDry run: nothing was written.");
      if (outcomes.some((o) => o.action === "skipped")) process.exitCode = 1;
    });
}
