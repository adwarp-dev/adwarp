import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "mcp-handler";
import { after } from "next/server";
import { track } from "@vercel/analytics/server";
import { withRequestCredentials, type RequestCredentials } from "@liads/core";
import { VERSION } from "@liads/shared";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { registerTools } from "@liads/mcp/tools";

/**
 * Hosted MCP server at /api/mcp (Streamable HTTP). Two ways in:
 *
 * 1. Bring your own credentials (multi-tenant): send your LinkedIn developer
 *    app details as headers on every request — X-Liads-Client-Id,
 *    X-Liads-Client-Secret, X-Liads-Refresh-Token, plus optional
 *    X-Liads-Account-Id and X-Liads-Linkedin-Version. The request runs
 *    entirely against YOUR app and ad account; no shared secret needed, since
 *    the headers grant nothing beyond what the caller already owns.
 *    Credentials are used in-memory only and never logged or persisted.
 *
 * 2. Env tenant (the deploy owner): no X-Liads headers. Credentials come from
 *    LIADS_* env vars and access is gated by MCP_AUTH_TOKEN.
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

/** Caller-supplied credentials, when the request carries all three required headers. */
function headerCredentials(req: Request): RequestCredentials | null {
  const clientId = req.headers.get("x-liads-client-id");
  const clientSecret = req.headers.get("x-liads-client-secret");
  const refreshToken = req.headers.get("x-liads-refresh-token");
  if (!clientId || !clientSecret || !refreshToken) return null;
  return {
    clientId,
    clientSecret,
    refreshToken,
    defaultAccountId: req.headers.get("x-liads-account-id") ?? undefined,
    linkedinVersion: req.headers.get("x-liads-linkedin-version") ?? undefined,
  };
}

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
        tenant: req.headers.get("x-liads-client-id") ? "byo" : "env",
      });
    }
  } catch {
    // ignore — analytics only
  }
}

async function guard(req: Request): Promise<Response> {
  after(() => trackMcpRequest(req));
  const creds = headerCredentials(req);
  if (creds) {
    return withRequestCredentials(creds, () => mcpHandler(req));
  }
  if (!authorized(req)) {
    return new Response(
      JSON.stringify({
        error: "unauthorized",
        hint: "Send Authorization: Bearer <MCP_AUTH_TOKEN>, or bring your own LinkedIn app via X-Liads-Client-Id / X-Liads-Client-Secret / X-Liads-Refresh-Token headers (see the README).",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }
  return mcpHandler(req);
}

export { guard as GET, guard as POST, guard as DELETE };
