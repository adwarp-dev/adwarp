import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { after } from "next/server";
import { track } from "@vercel/analytics/server";
import { requestCredentialsFromHeaders, withRequestCredentials } from "@adwarp/core";
import { VERSION } from "@adwarp/shared";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { registerTools } from "@adwarp/mcp/tools";

/**
 * Hosted MCP server at /api/mcp (Streamable HTTP). Two ways in:
 *
 * 1. Bring your own credentials (multi-tenant): send your LinkedIn developer
 *    app details as headers on every request: X-Adwarp-Linkedin-Client-Id,
 *    X-Adwarp-Linkedin-Client-Secret, X-Adwarp-Linkedin-Refresh-Token, plus
 *    optional X-Adwarp-Linkedin-Account-Id and X-Adwarp-Linkedin-Version. The
 *    pre-rename X-Liads-* names still work. The request runs
 *    entirely against YOUR app and ad account; no shared secret needed, since
 *    the headers grant nothing beyond what the caller already owns.
 *    Credentials are used in-memory only and never logged or persisted.
 *
 * 2. Env tenant (the deploy owner): no credential headers. Credentials come from
 *    ADWARP_LINKEDIN_* env vars (or the older LIADS_* names) and access is gated
 *    by MCP_AUTH_TOKEN.
 */
const mcpHandler = createMcpHandler(
  // The adapter's server is the same MCP SDK type; cast across the version boundary.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // Google tools are withheld here on purpose: this endpoint is multi-tenant
  // over per-request LinkedIn credentials, and Google credentials would come
  // from shared server env vars. See RegisterToolsOptions.
  (server) => registerTools(server as any, { google: false }),
  { serverInfo: { name: "adwarp", version: VERSION } },
  { basePath: "/api" },
);

/** Constant-time string comparison; never leaks how much of the token matched. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function authorized(req: Request): boolean {
  const token = process.env.MCP_AUTH_TOKEN;
  // Unset token: fail closed in production, open only for local development.
  if (!token) return process.env.NODE_ENV !== "production";
  // Header only — a `?key=` query param would leak the token into request logs.
  const auth = req.headers.get("authorization");
  return auth !== null && safeEqual(auth, `Bearer ${token}`);
}

/**
 * Records each MCP request as a Vercel Analytics custom event: the JSON-RPC
 * method, the tool name on tools/call, and whether the caller brought their
 * own credentials. Never the credentials or arguments themselves. Analytics
 * must never interfere with MCP traffic, so failures are swallowed.
 */
async function trackMcpRequest(req: Request): Promise<void> {
  try {
    if (req.method !== "POST") return;
    const body: unknown = await req.clone().json();
    const messages = Array.isArray(body) ? body : [body];
    for (const msg of messages) {
      const method = (msg as { method?: unknown })?.method;
      if (typeof method !== "string") continue;
      const tool =
        method === "tools/call"
          ? ((msg as { params?: { name?: unknown } }).params?.name as string | undefined)
          : undefined;
      await track("mcp_request", {
        method,
        tool: tool ?? null,
        tenant: requestCredentialsFromHeaders(req.headers) ? "byo" : "env",
      });
    }
  } catch {
    // ignore — analytics only
  }
}

async function guard(req: Request): Promise<Response> {
  after(() => trackMcpRequest(req));
  const creds = requestCredentialsFromHeaders(req.headers);
  if (creds) {
    return withRequestCredentials(creds, () => mcpHandler(req));
  }
  if (!authorized(req)) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        hint: "Send Authorization: Bearer <MCP_AUTH_TOKEN>, or bring your own LinkedIn app via X-Adwarp-Linkedin-Client-Id / X-Adwarp-Linkedin-Client-Secret / X-Adwarp-Linkedin-Refresh-Token headers (see https://adwarp.dev/docs/hosted).",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  return mcpHandler(req);
}

export { guard as GET, guard as POST, guard as DELETE };
