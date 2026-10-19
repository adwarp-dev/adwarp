// Config & auth
export * from "./config.js";
export * from "./auth.js";
export * from "./http.js";
export * from "./client.js";
export * from "./urns.js";

// Schemas (zod) — reused as MCP tool input schemas
export * from "./schemas.js";

// Resource modules
export * from "./resources/accounts.js";
export * from "./resources/campaignGroups.js";
export * from "./resources/campaigns.js";
export * from "./resources/targeting.js";
export * from "./resources/creatives.js";
export * from "./resources/images.js";
export * from "./resources/dmpSegments.js";
export * from "./resources/conversions.js";

// High-level workflows
export * from "./audience.js";
export * from "./audienceCsv.js";
export * from "./creative.js";
export * from "./orchestrate.js";
export * from "./resources/analytics.js";
export * from "./report.js";

// Change journal + lift comparison (local JSONL store).
export * from "./changelog.js";

// CRM readers: Salesforce (Phase 3 foundation) and HubSpot, each feeding matched audiences
export * from "./salesforce.js";
export * from "./hubspot.js";

// Competitor ad intelligence: official API and remote creative worker.
export * from "./adLibrary.js";
export * from "./adLibraryApi.js";
export * from "./competitorAds.js";

export * from "./remoteCreatives.js";
