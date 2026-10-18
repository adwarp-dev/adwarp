#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

const server = new McpServer({ name: "adwarp", version: "0.1.0" }); // Adwarp, the open-source ad agent for LinkedIn and Google Ads
registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
