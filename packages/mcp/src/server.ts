import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VERSION } from "@adwarp/shared";
import { registerTools } from "./tools.js";

/** Starts the local server with every tool on stdio. Shared by `adwarp-mcp` and `adwarp mcp`. */
export async function startStdioServer(): Promise<void> {
  const server = new McpServer({ name: "adwarp", version: VERSION }); // Adwarp, the open-source ad agent for LinkedIn and Google Ads
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
