/**
 * Turns a shortlist into record files for the adwarp.dev ad library (content/ads/<slug>.json), following the
 * ownership rules in record.ts:
 *
 * - A new file starts as media_pending: evidence saved, creative not inspected, no write-up.
 * - An existing file keeps everything the editor owns (status, selection, writeup, creative, review, category,
 *   format, the advertiser's name). The collector replaces `source`, `advertiser.platformId` and `evidence`,
 *   appends to `evidence.observations`, and fills `copy` only while it is null.
 * - Every file is checked with parseAdRecord before it is written. A file that can't be read, or a merge that would
 *   break the rules (an editor's most-seen pick whose metric disappeared, say), is reported and left untouched.
 * - Nothing is ever deleted.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { slugify } from "./parse.js";
import type { Ranked } from "./rank.js";
import { creativeFamily, evidenceOf } from "./rank.js";
import { type AdEvidence, type AdRecord, AdRecordError, parseAdRecord } from "./record.js";
import type { Candidate } from "./types.js";

export function recordSlug(c: Candidate): string {
  return slugify(`${c.advertiser.name} ${c.platform} ${c.format} ${c.source.adId}`);
}

/** The record a collection run would write for a ranked candidate, before any merge. */
export function newRecord(r: Ranked | { candidate: Candidate; collection: "editors-pick"; reason: string; family?: string }): AdRecord {
  const c = r.candidate;
  const family = r.family ?? creativeFamily(c);
  const evidence: AdEvidence = {
    ...evidenceOf(c),
    ...(c.live === null ? {} : { observations: [{ at: c.checkedAt, live: c.live }] }),
    ...(family ? { family } : {}),
  };
  return {
    version: 1,
    slug: recordSlug(c),
    status: "media_pending",
    statusNote: `Collected ${c.checkedAt}. Inspect the creative on its source page, then write the write-up to make it a draft.`,
    platform: c.platform,
    source: c.source,
    advertiser: c.advertiser,
    category: c.category,
    format: c.format,
    copy: c.copy,
    creative: { display: c.copy ? "drawn" : "source-link" },
    evidence,
    selection: { collection: r.collection, reason: r.reason },
    writeup: null,
  };
}

/** Observations from both runs, 1 per day (the newer run wins a shared day), oldest first. */
export function mergeObservations(
  older: AdEvidence["observations"] = [],
  newer: AdEvidence["observations"] = [],
): AdEvidence["observations"] {
  const byDay = new Map<string, { at: string; live: boolean }>();
  for (const o of [...older, ...newer]) byDay.set(o.at, o);
  const merged = [...byDay.values()].sort((a, b) => a.at.localeCompare(b.at));
  return merged.length ? merged : undefined;
}

/** Applies a fresh collection to an existing record without touching what the editor owns. */
export function mergeRecord(existing: AdRecord, fresh: AdRecord): AdRecord {
  const observations = mergeObservations(existing.evidence.observations, fresh.evidence.observations);
  const { observations: _drop, ...freshEvidence } = fresh.evidence;
  return {
    ...existing,
    source: fresh.source,
    advertiser: {
      ...existing.advertiser,
      ...(fresh.advertiser.platformId ? { platformId: fresh.advertiser.platformId } : {}),
    },
    copy: existing.copy ?? fresh.copy,
    evidence: { ...freshEvidence, ...(observations ? { observations } : {}) },
  };
}

/** Keys in a fixed order, so diffs in a pull request stay small and readable. */
const ORDER: (keyof AdRecord)[] = [
  "version",
  "slug",
  "status",
  "statusNote",
  "platform",
  "source",
  "advertiser",
  "category",
  "format",
  "copy",
  "creative",
  "evidence",
  "selection",
  "writeup",
  "review",
];

export function serializeRecord(record: AdRecord): string {
  const ordered: Record<string, unknown> = {};
  for (const key of ORDER) if (record[key] !== undefined) ordered[key] = record[key];
  for (const [key, value] of Object.entries(record)) if (!(key in ordered) && value !== undefined) ordered[key] = value;
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export type DraftOutcome =
  | { slug: string; action: "created" | "updated" | "unchanged"; path: string; status: string }
  | { slug: string; action: "skipped"; path: string; reason: string };

export interface WriteDraftsOptions {
  /** The website's content/ads directory. */
  dir: string;
  dryRun?: boolean;
}

export async function writeDrafts(records: AdRecord[], opts: WriteDraftsOptions): Promise<DraftOutcome[]> {
  if (!opts.dryRun) await mkdir(opts.dir, { recursive: true });
  const outcomes: DraftOutcome[] = [];
  for (const fresh of records) {
    const path = join(opts.dir, `${fresh.slug}.json`);
    let before: string | undefined;
    try {
      before = await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        outcomes.push({ slug: fresh.slug, action: "skipped", path, reason: `Can't read the file: ${(err as Error).message}` });
        continue;
      }
    }
    let next: AdRecord;
    try {
      if (before === undefined) next = parseAdRecord(fresh, fresh.slug);
      else {
        let existing: AdRecord;
        try {
          existing = parseAdRecord(JSON.parse(before), fresh.slug);
        } catch (err) {
          const why = err instanceof AdRecordError ? err.problems.join("; ") : (err as Error).message;
          outcomes.push({ slug: fresh.slug, action: "skipped", path, reason: `The existing file doesn't pass the record rules, so it was left alone: ${why}` });
          continue;
        }
        next = parseAdRecord(mergeRecord(existing, fresh), fresh.slug);
      }
    } catch (err) {
      const why = err instanceof AdRecordError ? err.problems.join("; ") : (err as Error).message;
      outcomes.push({ slug: fresh.slug, action: "skipped", path, reason: `The merged record would break the rules: ${why}` });
      continue;
    }
    const text = serializeRecord(next);
    if (text === before) {
      outcomes.push({ slug: fresh.slug, action: "unchanged", path, status: next.status });
      continue;
    }
    if (!opts.dryRun) await writeFile(path, text, "utf8");
    outcomes.push({ slug: fresh.slug, action: before === undefined ? "created" : "updated", path, status: next.status });
  }
  return outcomes;
}
