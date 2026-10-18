#!/usr/bin/env node
/**
 * Writes docs/tools.json: every MCP tool Adwarp exposes, read back over the
 * MCP protocol from the real registration code, so the file can never list a
 * tool the server does not have.
 *
 * Run it with `pnpm gen:tools` from the repo root, which builds this package
 * and its dependencies first. CI regenerates the file and fails on any diff.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../dist/tools.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT = join(ROOT, "docs", "tools.json");
const HOSTED_ROUTE = join(ROOT, "apps", "web", "app", "api", "[transport]", "route.ts");

/** What the hosted route passes to registerTools. Checked against the route below. */
const HOSTED_OPTIONS = { google: false };

/** Registers tools on a fresh server, connects a client in memory, and returns tools/list. */
async function listTools(options) {
  const server = new McpServer({ name: "adwarp", version: "0.1.0" });
  registerTools(server, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "adwarp-gen-tools", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  await client.close();
  await server.close();
  return tools;
}

// The hosted set is only right while the route still registers with HOSTED_OPTIONS.
const route = await readFile(HOSTED_ROUTE, "utf8");
if (!/registerTools\([^)]*\{\s*google:\s*false\s*\}\s*\)/.test(route)) {
  throw new Error(
    `${relative(ROOT, HOSTED_ROUTE)} no longer calls registerTools(server, { google: false }). ` +
      "Update HOSTED_OPTIONS in packages/mcp/scripts/gen-tools.mjs to match it.",
  );
}

// Same registration as the stdio entry point (src/index.ts): every tool.
const all = await listTools();
const hosted = new Set((await listTools(HOSTED_OPTIONS)).map((t) => t.name));

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const entries = all.sort(byName).map((t) => ({
  name: t.name,
  platform: t.name.startsWith("gads_") ? "google" : "linkedin",
  hosted: hosted.has(t.name),
  description: t.description ?? "",
  inputSchema: t.inputSchema,
}));

await writeFile(OUT, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`Wrote ${relative(ROOT, OUT)}: ${entries.length} tools (${hosted.size} hosted).`);
