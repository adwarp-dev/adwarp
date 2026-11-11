/**
 * Keeps every Ad Library call conservative, so an app never gets near LinkedIn's limits for the product.
 *
 * What LinkedIn says (learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits): limits are per app,
 * per endpoint, per day, unpublished, reset at midnight UTC, and answered with 429 when exceeded. LinkedIn emails the
 * app's admins at 75% of the daily quota, and the Developer Portal's Analytics tab shows an endpoint's limit once the
 * app has called it that day.
 *
 * - Pacing: at least AD_LIBRARY_MIN_INTERVAL_MS between calls in this process, plus jitter.
 * - Budget: a daily count of calls per app (keyed on a hash of the client ID) and UTC day, in a small state file
 *   shared by every run and process on the machine. A call over the budget is refused before it is sent.
 * - Throttling: a 429 is honored at most once per run, and only with a short Retry-After. Any other 429 stops the
 *   run (AdLibraryThrottledError), keeping what was collected. 401 and 403 stop at once (AdLibraryAccessError).
 */
import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { env, sleep as realSleep } from "@adwarp/shared";
import type { AdLibraryAd } from "./adLibrary.js";

export const AD_LIBRARY_MIN_INTERVAL_MS = 2200;
export const AD_LIBRARY_JITTER_MS = 600;
/** The longest Retry-After worth waiting for, once. Longer means the quota is spent for the day. */
export const AD_LIBRARY_MAX_RETRY_AFTER_SECONDS = 120;
/** The MCP tool's and the competitor CLI's daily budget, unless ADWARP_AD_LIBRARY_DAILY_CALLS says otherwise. */
export const DEFAULT_TOOL_DAILY_CALLS = 150;

/** Results collected before a run stopped, so callers keep them. */
export interface AdLibraryPartial {
  fetched: number;
  totalReported?: number;
  ads: (AdLibraryAd & { raw?: unknown })[];
}

/** Base of every error that ends an Ad Library run rather than 1 advertiser's search. */
export class AdLibraryStopError extends Error {
  partial?: AdLibraryPartial;
  constructor(
    readonly reason: "throttled" | "budget" | "access",
    message: string,
  ) {
    super(message);
    this.name = "AdLibraryStopError";
  }
}

/** 401 or 403: the token is invalid or revoked, or the app isn't approved for the Ad Library product. */
export class AdLibraryAccessError extends AdLibraryStopError {
  constructor(message: string) {
    super("access", message);
    this.name = "AdLibraryAccessError";
  }
}

/** A 429 that wasn't worth waiting out: the app's daily quota is likely spent until midnight UTC. */
export class AdLibraryThrottledError extends AdLibraryStopError {
  constructor(message: string) {
    super("throttled", message);
    this.name = "AdLibraryThrottledError";
  }
}

/** The local daily budget is used up. Nothing was sent to LinkedIn. */
export class AdLibraryBudgetError extends AdLibraryStopError {
  constructor(
    message: string,
    readonly limit: number,
    readonly used: number,
  ) {
    super("budget", message);
    this.name = "AdLibraryBudgetError";
  }
}

/** "3h 12m" until the next midnight UTC, when LinkedIn's daily limits reset. */
export function untilMidnightUtc(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Seconds from a Retry-After header (seconds or an HTTP date), or undefined. */
export function retryAfterSeconds(header: string | undefined | null, now: Date = new Date()): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return n;
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now.getTime()) / 1000)) : undefined;
}

/** A hash of the app's client ID: the budget's key. The ID itself and any token are never stored. */
export function adLibraryAppKey(clientId: string | undefined): string {
  return clientId ? createHash("sha256").update(clientId).digest("hex").slice(0, 16) : "unknown-app";
}

/**
 * Where the daily call counts live: ADWARP_AD_LIBRARY_STATE_DIR, else $XDG_STATE_HOME/adwarp/ad-library, else
 * ~/.local/state/adwarp/ad-library. Away from ~/.adwarp, which holds credentials.
 */
export function adLibraryStateDir(): string {
  const set = env("ADWARP_AD_LIBRARY_STATE_DIR");
  if (set) return set;
  const xdg = process.env.XDG_STATE_HOME?.trim();
  return join(xdg || join(homedir(), ".local", "state"), "adwarp", "ad-library");
}

/**
 * A daily budget of Ad Library calls for 1 app: 1 byte appended per call to `<app key>-<UTC day>.calls`, so
 * concurrent runs on the machine share the count. A run started near the limit can overshoot by the calls another
 * process makes in the same instant, never by more.
 */
export class DailyCallBudget {
  readonly limit: number;
  readonly key: string;
  private dir: string;
  private readonly now: () => Date;
  private ready = false;
  /** Set when the state folder wasn't writable and the count moved to the system temp folder. */
  fellBack = false;

  constructor(opts: { limit: number; clientId?: string; dir?: string; now?: () => Date }) {
    if (!Number.isInteger(opts.limit) || opts.limit < 1) throw new Error("The daily Ad Library budget must be a whole number of 1 or more.");
    this.limit = opts.limit;
    this.key = adLibraryAppKey(opts.clientId);
    this.dir = opts.dir ?? adLibraryStateDir();
    this.now = opts.now ?? (() => new Date());
  }

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  file(): string {
    return join(this.dir, `${this.key}-${this.day()}.calls`);
  }

  private async prepare(): Promise<void> {
    if (this.ready) return;
    try {
      await mkdir(this.dir, { recursive: true });
    } catch {
      // A read-only home (a hosted deploy): count in the temp folder, which lasts as long as the machine does.
      this.dir = join(tmpdir(), "adwarp-ad-library");
      this.fellBack = true;
      await mkdir(this.dir, { recursive: true });
    }
    // Forget this app's counts from more than a week ago.
    const cutoff = new Date(this.now().getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      const m = name.match(/^([0-9a-z-]+)-(\d{4}-\d{2}-\d{2})\.calls$/);
      if (m && m[1] === this.key && (m[2] ?? "") < cutoff) await unlink(join(this.dir, name)).catch(() => undefined);
    }
    this.ready = true;
  }

  async used(): Promise<number> {
    await this.prepare();
    return stat(this.file()).then((s) => s.size).catch(() => 0);
  }

  async remaining(): Promise<number> {
    return Math.max(0, this.limit - (await this.used()));
  }

  /** Counts 1 call, or refuses it when the budget is spent. */
  async take(): Promise<void> {
    const used = await this.used();
    if (used >= this.limit)
      throw new AdLibraryBudgetError(
        `The daily budget of ${this.limit} Ad Library calls for this app is used (${used} today, UTC), so the call wasn't sent. 0 calls left; it resets at midnight UTC, in ${untilMidnightUtc(this.now())}.`,
        this.limit,
        used,
      );
    await appendFile(this.file(), ".");
  }
}

/** When the last Ad Library call went out. Process-wide by default, so separate searches and tool calls stay paced. */
export interface AdLibraryPacer {
  last: number;
}
const processPacer: AdLibraryPacer = { last: 0 };

export interface AdLibraryGuardOptions {
  budget?: DailyCallBudget | null;
  /** Raised to AD_LIBRARY_MIN_INTERVAL_MS when lower. */
  minIntervalMs?: number;
  jitterMs?: number;
  pacer?: AdLibraryPacer;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

/** 1 run's pacing, budget and throttle state. Share 1 guard across every search in a run. */
export class AdLibraryGuard {
  readonly budget: DailyCallBudget | null;
  readonly minIntervalMs: number;
  readonly jitterMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  private readonly random: () => number;
  private readonly pacer: AdLibraryPacer;
  /** Calls sent through this guard. */
  calls = 0;
  /** Whether this run already waited out a 429. A second one stops it. */
  waitedOutThrottle = false;

  constructor(opts: AdLibraryGuardOptions = {}) {
    this.budget = opts.budget ?? null;
    this.minIntervalMs = Math.max(AD_LIBRARY_MIN_INTERVAL_MS, opts.minIntervalMs ?? 0);
    this.jitterMs = Math.max(0, opts.jitterMs ?? AD_LIBRARY_JITTER_MS);
    this.pacer = opts.pacer ?? processPacer;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  /** Before each call: refuse it when the budget is spent, else wait out the pacing and count it. */
  async beforeCall(): Promise<void> {
    await this.budget?.take();
    const due = this.pacer.last + this.minIntervalMs + Math.floor(this.random() * this.jitterMs);
    const wait = due - this.now();
    if (this.pacer.last && wait > 0) await this.sleep(wait);
    this.pacer.last = this.now();
    this.calls++;
  }
}

/** The tool's guard: process pacing, plus the daily budget for the app (ADWARP_AD_LIBRARY_DAILY_CALLS, 150). */
export function toolAdLibraryGuard(clientId: string | undefined): AdLibraryGuard {
  const set = Number(env("ADWARP_AD_LIBRARY_DAILY_CALLS"));
  const limit = Number.isInteger(set) && set > 0 ? set : DEFAULT_TOOL_DAILY_CALLS;
  return new AdLibraryGuard({ budget: new DailyCallBudget({ limit, ...(clientId ? { clientId } : {}) }) });
}
