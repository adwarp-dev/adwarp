import { randomUUID } from "node:crypto";
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LIADS_DIR } from "./paths.js";
import { liftWindows, type LiftWindowSpec } from "./period.js";
import { pctChange } from "./metrics.js";

/**
 * Change journal — an append-only, local record of every change made to an ad
 * entity, so a later "lift" report can compare performance before vs. after a
 * change. Stored as JSON Lines at ~/.liads/changelog.jsonl (one event per line):
 * append-only writes are safe across concurrent runs, the file is greppable and
 * diffable, and it needs no database.
 *
 * One journal covers every platform. Events carry a `platform` field so a
 * LinkedIn campaign and a Google campaign can share the file without their ids
 * colliding in a filtered read. Lines written before Google support existed have
 * no such field and read back as LinkedIn, so old journals stay valid.
 *
 * This is deliberately a local file, not a hosted store, so it works for any
 * open-source user the moment they clone the repo — no account or token to set up.
 */

export type AdPlatform = "linkedin" | "google";

/**
 * Every ad entity worth tracking for lift, across platforms. LinkedIn uses
 * campaignGroup / campaign / creative; Google uses campaign / adGroup / ad /
 * keyword. Each platform narrows this to the subset it can actually report on.
 */
export type AdEntityType = "campaignGroup" | "campaign" | "adGroup" | "creative" | "ad" | "keyword";

export interface ChangedField {
  field: string;
  /** Prior value, when known (auto-capture of updates doesn't fetch the old value). */
  before?: unknown;
  after: unknown;
}

export interface ChangeEvent {
  /** Stable id for this event. */
  id: string;
  /** ISO 8601 (UTC) timestamp the change took effect. */
  ts: string;
  /** Which ad platform the entity lives on. Absent on pre-multi-platform lines. */
  platform?: AdPlatform;
  /**
   * Who/what made the change. "liam" marks a change this tool captured itself; the value
   * predates the Adwarp rename and stays frozen so existing journals keep parsing.
   */
  source: "liam" | "manual";
  /** create = entity made; update = field(s) changed; note = freeform annotation. */
  kind: "create" | "update" | "note";
  entity: { type: AdEntityType; id: string; name?: string; accountId?: string };
  /** Field-level diffs (for updates). */
  fields?: ChangedField[];
  /** Human-readable one-liner describing the change. */
  summary?: string;
  /** Optional user hypothesis/label (e.g. "outcome-led headline test"). */
  label?: string;
  tags?: string[];
}

/** A change to record — id and ts are filled in by `recordChange` if omitted. */
export type ChangeInput = Omit<ChangeEvent, "id" | "ts"> & { ts?: string };

/** Events with no `platform` predate multi-platform support and are LinkedIn's. */
export const eventPlatform = (e: ChangeEvent): AdPlatform => e.platform ?? "linkedin";

/* --------------------------------- storage ---------------------------------- */

/** Path to the JSONL journal. Override with LIADS_CHANGELOG_PATH (e.g. for tests). */
export function changelogPath(): string {
  return process.env.LIADS_CHANGELOG_PATH ?? join(LIADS_DIR, "changelog.jsonl");
}

/**
 * Append one change to the journal. Best-effort: a write failure (e.g. a
 * read-only filesystem on a hosted deploy) is swallowed so it never breaks the
 * mutation that triggered it. Returns the stored event (with id + ts filled in).
 */
export async function recordChange(input: ChangeInput): Promise<ChangeEvent> {
  const { ts, ...rest } = input;
  const event: ChangeEvent = { id: `chg_${randomUUID().slice(0, 8)}`, ts: ts ?? new Date().toISOString(), ...rest };
  try {
    const path = changelogPath();
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    /* journal is non-critical; never break the caller */
  }
  return event;
}

export interface ChangeFilter {
  platform?: AdPlatform;
  type?: AdEntityType;
  id?: string;
  tag?: string;
  /** ISO timestamps, inclusive bounds. */
  since?: string;
  until?: string;
}

/** Read the journal back, newest first, optionally filtered. Empty if none yet. */
export async function readChanges(filter?: ChangeFilter): Promise<ChangeEvent[]> {
  let raw: string;
  try {
    raw = await readFile(changelogPath(), "utf8");
  } catch {
    return [];
  }
  const events = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as ChangeEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is ChangeEvent => e !== null)
    .filter((e) => {
      if (filter?.platform && eventPlatform(e) !== filter.platform) return false;
      if (filter?.type && e.entity.type !== filter.type) return false;
      if (filter?.id && e.entity.id !== filter.id) return false;
      if (filter?.tag && !(e.tags ?? []).includes(filter.tag)) return false;
      if (filter?.since && e.ts < filter.since) return false;
      if (filter?.until && e.ts > filter.until) return false;
      return true;
    });
  return events.sort((a, b) => b.ts.localeCompare(a.ts));
}

/* ---------------------------------- lift ------------------------------------ */

export interface LiftWindow<M> extends LiftWindowSpec {
  metrics: M;
}

export interface ChangeLift<M> {
  change: ChangeEvent;
  before: LiftWindow<M>;
  after: LiftWindow<M>;
  /** Relative change per metric (e.g. ctr 0.12 = +12%). */
  deltas: Record<string, number>;
}

/**
 * For each recorded change, compare performance in the window before it against
 * the window starting on it. Platform-agnostic: the caller supplies `fetch`,
 * which pulls that platform's metrics for a date range, and `metricKeys`, the
 * KPIs to delta.
 *
 * This is a directional pre/post comparison, not a controlled experiment — it is
 * confounded by seasonality, the learning phase after an edit, and any
 * concurrent budget change. Read the deltas as a signal, not proof.
 */
export async function computeChangeLift<M extends object>(opts: {
  changes: ChangeEvent[];
  windowDays?: number;
  now?: Date;
  /** Which keys of M to compute relative deltas for. */
  metricKeys: readonly string[];
  /** Pulls metrics for one window. Called once per window per change. */
  fetch: (window: LiftWindowSpec) => Promise<M>;
  /** Returned for an after-window of zero days (the change is from today). */
  empty: M;
}): Promise<ChangeLift<M>[]> {
  const windowDays = opts.windowDays ?? 14;
  const results: ChangeLift<M>[] = [];

  for (const change of opts.changes) {
    const { before: beforeSpec, after: afterSpec } = liftWindows(change.ts, windowDays, opts.now);
    const before = await opts.fetch(beforeSpec);
    const after = afterSpec.days > 0 ? await opts.fetch(afterSpec) : opts.empty;

    const deltas: Record<string, number> = {};
    for (const k of opts.metricKeys) {
      deltas[k] = pctChange((after as any)[k] ?? 0, (before as any)[k] ?? 0, true);
    }

    results.push({
      change,
      before: { ...beforeSpec, metrics: before },
      after: { ...afterSpec, metrics: after },
      deltas,
    });
  }
  return results;
}
