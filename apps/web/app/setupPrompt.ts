/**
 * The paste-in setup prompts shown on the landing page. Both share the same
 * core steps; only the last mile differs (CLI usage vs registering the MCP
 * server). README.md carries a combined version of the same walkthrough.
 */
const INTRO = `You are helping me set up Adwarp, an open-source LinkedIn Ads Manager from
https://github.com/adwarp-dev/adwarp. It runs locally as a CLI and an MCP server.
Everything it creates on LinkedIn is a draft, so nothing spends money until I
activate it myself in Campaign Manager.

Walk me through the setup one step at a time. Run commands for me where you can,
show me exactly what to click where you cannot, and wait for my confirmation
before moving to the next step.

1. Check that git, Node.js 20 or newer, and pnpm are installed. Help me install
   whatever is missing.
2. Clone https://github.com/adwarp-dev/adwarp and run "pnpm install" then
   "pnpm -r build" in the repo root.
3. Help me create a LinkedIn developer app at
   https://www.linkedin.com/developers/apps (it must be associated with my
   company's LinkedIn Page):
   a. On the Products tab, request access to the "Advertising API" product.
      This is the only required product; approval can take a while.
   b. Optional: also request "Audiences" if I want to upload CSV contact or
      company lists as matched audiences.
   c. Optional: also request "LinkedIn Ad Library" if I want competitor ad
      metadata through the official API.
   d. On the Auth tab, add http://localhost:53682/callback as an authorized
      redirect URL, and show me where the Client ID and Client Secret live.
4. Create ~/.liads/config.json containing my clientId, clientSecret, and
   "linkedinVersion": "202605".
5. Run "node packages/cli/dist/index.js auth login". My browser opens LinkedIn's
   consent screen; after I approve, tokens are stored in ~/.liads/credentials.json.
6. Verify with "node packages/cli/dist/index.js accounts list". If no accounts
   show up, remind me to map my ad account in the Developer Portal under
   Products > Advertising API > View Ad Accounts. Then set my account id as
   "defaultAccountId" in ~/.liads/config.json.`;

const OUTRO = `

If any step fails, show me the exact error and fix it with me before moving on.`;

export const CLI_SETUP_PROMPT = `${INTRO}
7. Link the CLI globally with "cd packages/cli && pnpm link --global" so I can
   run "adwarp" from anywhere, and confirm "adwarp accounts list" works.
8. Show me a first session: "adwarp report summary -p last_30_days" and
   "adwarp targeting search titles" with a title I care about.${OUTRO}`;

export const HOSTED_MCP_SETUP_PROMPT = `You are helping me connect to the hosted MCP endpoint of Adwarp, an
open-source LinkedIn Ads Manager (https://github.com/adwarp-dev/adwarp), at
https://mcp.adwarp.dev/api/mcp. I bring my own
LinkedIn developer app credentials as request headers, so every call runs
against my own LinkedIn ad account, and everything Adwarp creates is a draft
that spends nothing until I activate it myself in Campaign Manager.

Work one step at a time, run commands for me where you can, and wait for my
confirmation before moving on.

1. Help me create a LinkedIn developer app at
   https://www.linkedin.com/developers/apps (it must be associated with my
   company's LinkedIn Page). On the Products tab request "Advertising API";
   on the Auth tab add http://localhost:53682/callback as a redirect URL and
   show me where the Client ID and Client Secret live.
2. Mint my refresh token, the one step that runs locally: clone
   https://github.com/adwarp-dev/adwarp, run "pnpm install" and "pnpm -r build",
   write my clientId and clientSecret into ~/.liads/config.json, then run
   "node packages/cli/dist/index.js auth login" and approve in the browser.
3. Run "node packages/cli/dist/index.js auth export --mcp". It prints the
   exact "claude mcp add" command with my credentials as X-Liads headers.
   Run that command for me (or show me where to paste the headers in my MCP
   client's config if I am not on Claude Code).
4. Confirm the adwarp tools load and show me one read-only call working, for
   example list_ad_accounts. If my default account is missing, add an
   "X-Liads-Account-Id" header with my ad account id.

Remind me that my credentials travel with every call to that server, and that
I can self-host the same endpoint on my own Vercel account if I prefer
(the README has the steps).

If a step fails, show me the exact error and fix it with me before moving on.`;

export const MCP_SETUP_PROMPT = `You are helping me connect Adwarp, an open-source LinkedIn Ads Manager
(https://github.com/adwarp-dev/adwarp), to Claude as an MCP server. Everything
it creates on LinkedIn is a draft, so nothing spends money until I activate it
myself in Campaign Manager.

Work one step at a time, run commands for me where you can, and wait for my
confirmation before moving on.

1. Register the MCP server:
   - In Claude Code: claude mcp add adwarp -- node <abs repo path>/packages/mcp/dist/index.js
   - For Claude Desktop or another MCP client, add {"command": "node", "args":
     ["<abs repo path>/packages/mcp/dist/index.js"]} under mcpServers in its
     config, and tell me where that config file lives on my machine.
2. Confirm the adwarp tools load, then show me one read-only call working, for
   example list_ad_accounts or a last_30_days performance summary.

Only if step 1 has nothing to point at yet, do the one-time install first:
clone https://github.com/adwarp-dev/adwarp, run "pnpm install" and
"pnpm -r build", put the clientId and clientSecret from my LinkedIn developer
app (Advertising API product, redirect URL http://localhost:53682/callback)
in ~/.liads/config.json, then run "node packages/cli/dist/index.js auth login"
and verify with "node packages/cli/dist/index.js accounts list".

If a step fails, show me the exact error and fix it with me before moving on.`;
