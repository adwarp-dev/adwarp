import { z } from "zod";
import { env } from "@adwarp/shared";

const CreativeSchema = z.object({
  id: z.string().regex(/^\d+$/),
  status: z.enum(["pending", "running", "done", "failed", "missing"]),
  collectedAt: z.string().optional(),
  error: z.string().optional(),
  copy: z.object({
    commentary: z.string().optional(), imageUrl: z.string().optional(),
    headline: z.string().optional(), cta: z.string().optional(),
    screenshotPath: z.string().optional(),
  }).optional(),
});
const ResultSchema = z.object({
  blocked: z.boolean(), note: z.string().optional(), creatives: z.array(CreativeSchema),
});
export type RemoteCreativeResult = z.infer<typeof ResultSchema>;

export function creativeWorkerConfig() {
  const url = env("ADWARP_CREATIVE_WORKER_URL");
  const token = env("ADWARP_CREATIVE_WORKER_TOKEN");
  if (!url || !token) throw new Error("Remote creative worker is not configured; API metadata only. Local scraping is disabled.");
  const base = new URL(url);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("ADWARP_CREATIVE_WORKER_URL must be an HTTPS URL without credentials, query or fragment.");
  }
  return { base: base.origin, token };
}

/** Bounded, authenticated remote request. No browser dependency or local fallback. */
export async function getRemoteCreatives(ids: string[], enqueue = false): Promise<RemoteCreativeResult> {
  const unique = [...new Set(ids)];
  if (!unique.length) return { blocked: false, creatives: [] };
  if (unique.length > 10 || unique.some(id => !/^\d{1,30}$/.test(id))) throw new Error("Provide at most 10 numeric ad IDs.");
  const { base, token } = creativeWorkerConfig();
  const path = enqueue ? "/v1/creatives" : `/v1/creatives?ids=${unique.join(",")}`;
  const response = await fetch(`${base}${path}`, {
    method: enqueue ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(enqueue ? { body: JSON.stringify({ ids: unique }) } : {}),
  });
  if (!response.ok) throw new Error(`Remote creative worker returned HTTP ${response.status}; local scraping remains disabled.`);
  return ResultSchema.parse(await response.json());
}
