/**
 * @adwarp/google — the Google Ads engine. Mirrors @adwarp/core's shape: config
 * and auth, one HTTP chokepoint, thin typed resource modules, zod schemas as
 * the single source of truth for CLI and MCP inputs.
 *
 * Safety: nothing in this package can create an enabled entity. Campaigns, ad
 * groups, and ads are created PAUSED, the schemas cannot express any other
 * status, and every write is validated server-side first with validateOnly.
 * Turning a campaign on is a human action in the Google Ads UI.
 */

// Config & auth
export * from "./config.js";
export * from "./auth.js";
export * from "./http.js";
export * from "./client.js";

// Query and write primitives
export * from "./gaql.js";
export * from "./mutate.js";

// Schemas (zod) — reused as MCP tool input schemas
export * from "./schemas.js";

// Resource modules
export * from "./resources/customers.js";
export * from "./resources/constants.js";
export * from "./resources/conversions.js";
export * from "./resources/keywordIdeas.js";
export * from "./resources/campaigns.js";

// High-level workflows
export * from "./orchestrate.js";
export * from "./report.js";

// Change journal (shares changelog.jsonl with LinkedIn)
export * from "./changelog.js";
