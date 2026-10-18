import Link from "next/link";

const REPO = "https://github.com/adwarp-dev/adwarp";
const HOSTED_URL = "https://mcp.adwarp.dev/api/mcp";
const LEGACY_HOSTED_URL = "https://liam-mcp.vercel.app/api/mcp";

export const metadata = {
  title: "Docs · Adwarp",
  description:
    "Everything in the repo README, on one page: LinkedIn app setup, local MCP, the hosted endpoint with your own credentials, CLI reference, tools, skills, and safety.",
};

const TOC: Array<{ href: string; label: string }> = [
  { href: "#overview", label: "Overview" },
  { href: "#linkedin-app", label: "Step 0: LinkedIn app" },
  { href: "#build-auth", label: "Step 1: build + auth" },
  { href: "#local-mcp", label: "Local MCP" },
  { href: "#hosted-mcp", label: "Hosted MCP" },
  { href: "#self-host", label: "Self-host" },
  { href: "#cli", label: "CLI" },
  { href: "#tools", label: "Tools" },
  { href: "#cli-reference", label: "CLI reference" },
  { href: "#skills", label: "Skills" },
  { href: "#journal", label: "Change journal" },
  { href: "#configuration", label: "Configuration" },
  { href: "#salesforce", label: "Salesforce" },
  { href: "#safety", label: "Safety" },
];

export default function Docs() {
  return (
    <div className="wrap docs">
      <header className="topbar reveal d1">
        <span>
          <b>
            <Link href="/" style={{ color: "inherit", textDecoration: "none", border: "none" }}>
              ADWARP
            </Link>
          </b>{" "}
          · LINKEDIN ADS MANAGER
        </span>
        <nav className="topnav">
          <a href="/docs" aria-current="page">
            DOCS
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
      </header>

      <main>
        <header className="dochead">
          <h1 className="docmark reveal d1">Docs</h1>
          <p className="lede reveal d2">
            Everything you need to run Adwarp: the LinkedIn app, the local MCP server, the{" "}
            <em>hosted endpoint you can use with your own credentials</em>, the CLI, and the
            playbook skills on top. This page mirrors the{" "}
            <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
              repo README
            </a>
            .
          </p>
          <nav className="toc reveal d3">
            {TOC.map((t) => (
              <a key={t.href} href={t.href}>
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        <section id="overview" className="section">
          <p className="kicker">Overview</p>
          <h2>What Adwarp is.</h2>
          <p>
            Adwarp is an ad manager for LinkedIn. You describe the campaign in plain language and
            Adwarp drafts the audience, the ad groups, and the ads, from Claude over MCP or from a
            CLI. It covers creation, matched audiences (including building one straight from
            Salesforce), conversion selection, performance reporting, competitor ad intelligence,
            and a change journal with before and after lift.
          </p>
          <p>
            Everything Adwarp creates starts as a <b>draft</b>. Nothing spends until you explicitly
            ask for a campaign to go live or switch it on yourself in Campaign Manager.
          </p>
          <h3>Hierarchy mapping</h3>
          <p>LinkedIn names its levels differently than Google or Meta.</p>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Common term</th>
                  <th>LinkedIn entity</th>
                  <th>Holds</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Campaign</td>
                  <td>Campaign Group</td>
                  <td>status, total or shared budget</td>
                </tr>
                <tr>
                  <td>Ad group</td>
                  <td>Campaign</td>
                  <td>targeting, budget, bid, schedule, format</td>
                </tr>
                <tr>
                  <td>Ad</td>
                  <td>Creative</td>
                  <td>
                    the rendered ad (<code>status: DRAFT</code>)
                  </td>
                </tr>
                <tr>
                  <td>Audience</td>
                  <td>DMP Segment</td>
                  <td>attached to a Campaign&apos;s targeting</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="linkedin-app" className="section">
          <p className="kicker">Step 0 · once</p>
          <h2>Create a LinkedIn app.</h2>
          <p>
            Adwarp runs against <em>your own LinkedIn developer app</em>, so your credentials and
            your ad account stay yours.
          </p>
          <ol>
            <li>
              Create an app at{" "}
              <a href="https://www.linkedin.com/developers/apps" target="_blank" rel="noreferrer">
                linkedin.com/developers/apps
              </a>
              . It must be associated with your company&apos;s LinkedIn Page.
            </li>
            <li>On the Products tab, request access to the products below.</li>
            <li>
              On the Auth tab, add <code>http://localhost:53682/callback</code> as an authorized
              redirect URL, and note your Client ID and Client Secret.
            </li>
            <li>
              Once the Advertising API is approved, map your ad account under Products &gt;
              Advertising API &gt; View Ad Accounts. Skip this and <code>accounts list</code>{" "}
              comes back empty.
            </li>
          </ol>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Needed for</th>
                  <th>Required?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Advertising API</td>
                  <td>campaigns, ads, targeting, reporting, conversions</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>Audiences</td>
                  <td>uploading CSV contact and company lists as matched audiences</td>
                  <td>Only for audience upload</td>
                </tr>
                <tr>
                  <td>LinkedIn Ad Library</td>
                  <td>competitor ad metadata via the official API</td>
                  <td>Optional (the browser scraper works without it)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>OAuth scopes</h3>
          <p>
            <code>adwarp auth login</code> requests <code>rw_ads</code> (create and edit campaigns),{" "}
            <code>r_ads_reporting</code> (reporting), <code>rw_conversions</code> (conversion
            tracking), and <code>w_organization_social</code> (image ads create a post owned by
            your LinkedIn Page). If you add a product or scope later, run <code>auth login</code>{" "}
            again; a token refresh keeps only the scopes you originally granted.
          </p>
        </section>

        <section id="build-auth" className="section">
          <p className="kicker">Step 1 · once</p>
          <h2>Build and authenticate.</h2>
          <p>Requires git, Node.js 20 or newer, and pnpm.</p>
          <pre className="code" tabIndex={0}>{`git clone https://github.com/adwarp-dev/adwarp.git
cd adwarp
pnpm install && pnpm -r build

# App credentials (alternatively set LIADS_CLIENT_ID / LIADS_CLIENT_SECRET env vars)
mkdir -p ~/.liads
echo '{ "clientId": "...", "clientSecret": "...", "linkedinVersion": "202605" }' > ~/.liads/config.json

node packages/cli/dist/index.js auth login      # opens the browser; tokens land in ~/.liads
node packages/cli/dist/index.js accounts list   # verify, then set defaultAccountId in config.json`}</pre>
        </section>

        <section id="local-mcp" className="section">
          <p className="kicker">Option 1</p>
          <h2>Install as a local MCP server.</h2>
          <p>
            Register the server with your MCP client; it reads the <code>~/.liads</code>{" "}
            credentials from step 1.
          </p>
          <pre className="code" tabIndex={0}>{`# Claude Code
claude mcp add adwarp -- node /abs/path/adwarp/packages/mcp/dist/index.js

# Claude Desktop, Cursor, or any MCP client, in its MCP config JSON:
{
  "mcpServers": {
    "adwarp": { "command": "node", "args": ["/abs/path/adwarp/packages/mcp/dist/index.js"] }
  }
}`}</pre>
          <p>
            Ask for something read-only to confirm it works: &quot;List my ad accounts&quot; or
            &quot;How did my account do in the last 30 days?&quot;
          </p>
        </section>

        <section id="hosted-mcp" className="section">
          <p className="kicker">Option 1b · nothing to deploy</p>
          <h2>Use the hosted MCP with your own credentials.</h2>
          <p>The hosted MCP server at</p>
          <pre className="code" tabIndex={0}>{HOSTED_URL}</pre>
          <p>
            is <b>multi-tenant, bring your own credentials</b>: you pass your LinkedIn developer
            app&apos;s details as request headers, and every call runs against <em>your</em> app
            and <em>your</em> ad account. The server holds no state for you. Credentials are used
            in memory to call LinkedIn and never logged or persisted. The original address,{" "}
            <code>{LEGACY_HOSTED_URL}</code>, still works and serves the same endpoint, so existing
            connections need no change.
          </p>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                  <th>Required?</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>X-Liads-Client-Id</code>
                  </td>
                  <td>your LinkedIn app&apos;s Client ID</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>
                    <code>X-Liads-Client-Secret</code>
                  </td>
                  <td>your LinkedIn app&apos;s Client Secret</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>
                    <code>X-Liads-Refresh-Token</code>
                  </td>
                  <td>a refresh token from your auth login (about 365 days)</td>
                  <td>Yes</td>
                </tr>
                <tr>
                  <td>
                    <code>X-Liads-Account-Id</code>
                  </td>
                  <td>numeric ad account id used when a call omits one</td>
                  <td>No</td>
                </tr>
                <tr>
                  <td>
                    <code>X-Liads-Linkedin-Version</code>
                  </td>
                  <td>API version pin (YYYYMM), defaults to the server&apos;s</td>
                  <td>No</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Do step 0 and step 1 above once. LinkedIn&apos;s OAuth consent has to happen in your
            browser, so the token mint is the one local step. Then print the ready-to-run connect
            command:
          </p>
          <pre className="code" tabIndex={0}>{`node packages/cli/dist/index.js auth export --mcp
# claude mcp add --transport http adwarp ${HOSTED_URL} \\
#   --header "X-Liads-Client-Id: ..." \\
#   --header "X-Liads-Client-Secret: ..." \\
#   --header "X-Liads-Refresh-Token: ..." \\
#   --header "X-Liads-Account-Id: ..."`}</pre>
          <p>
            Any MCP client that supports custom headers works the same way (for clients without
            native HTTP transport: <code>npx mcp-remote &lt;url&gt; --header ...</code>). Verify
            with a read-only call (&quot;list my ad accounts&quot;), and from then on the
            connection is just a URL plus headers, usable from machines that never cloned the
            repo.
          </p>
          <p>
            Know the trade-off: your client secret and refresh token travel with every request to
            that server, so only point them at a deployment you trust, or self-host the identical
            endpoint (next section). The same scopes that manage ads can also switch them on,
            so treat these credentials like an ad account password.
          </p>
          <h3>Hosted limitations</h3>
          <p>
            All by design, they need local resources: <code>upload_audience_csv</code> reads a CSV
            path on the server, <code>audience_from_salesforce</code> needs your local{" "}
            <code>sf</code> CLI, competitor-ads scraping falls back to API-only metadata (no
            browser), and the change journal and lift tools need the local{" "}
            <code>~/.liads/changelog.jsonl</code>. Run those through the local MCP server or the
            CLI.
          </p>
          <h3>Put a skill on top</h3>
          <p>
            The clean split for teams: your MCP client&apos;s config holds the credentials (the
            headers above), and a small skill or system prompt holds your playbook: default ad
            account, naming conventions, standing exclusions, house rules like &quot;audience
            expansion always off&quot;. The{" "}
            <a href={`${REPO}/tree/main/skills`} target="_blank" rel="noreferrer">
              skills folder
            </a>{" "}
            in the repo is a working example; copy one, swap in your defaults, and your assistant
            drives the hosted tools with your rules. Credentials never belong in a skill file.
          </p>
        </section>

        <section id="self-host" className="section">
          <p className="kicker">Option 1c</p>
          <h2>Self-host the same endpoint on Vercel.</h2>
          <p>
            Run your own instance so credentials never touch shared infrastructure, and so you
            also get a private env-configured tenant.
          </p>
          <ol>
            <li>
              Get your env values locally: <code>node packages/cli/dist/index.js auth export</code>
              .
            </li>
            <li>
              Deploy <code>apps/web</code> to Vercel (set the project Root Directory to{" "}
              <code>apps/web</code>).
            </li>
            <li>
              In Vercel project settings, add the env vars from <code>.env.example</code>{" "}
              (<code>LIADS_CLIENT_ID</code>, <code>LIADS_CLIENT_SECRET</code>,{" "}
              <code>LIADS_REFRESH_TOKEN</code>, <code>LIADS_LINKEDIN_VERSION</code>, and a strong{" "}
              <code>MCP_AUTH_TOKEN</code>). In Deployment Protection settings, disable Vercel
              Authentication for production (or add a protection-bypass secret); otherwise MCP
              clients can&apos;t reach the endpoint.
            </li>
            <li>
              Your MCP endpoint is <code>https://&lt;your-app&gt;.vercel.app/api/mcp</code>.
              Connect with the secret in the header.
            </li>
          </ol>
          <pre className="code" tabIndex={0}>{`claude mcp add --transport http adwarp https://<your-app>.vercel.app/api/mcp \\
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"`}</pre>
          <p>
            Requests carrying <code>MCP_AUTH_TOKEN</code> use the env credentials (your tenant).
            Requests carrying the <code>X-Liads-*</code> headers use the caller&apos;s credentials
            instead, so one self-hosted instance can serve your whole team, each member on their
            own LinkedIn app.
          </p>
        </section>

        <section id="cli" className="section">
          <p className="kicker">Option 2</p>
          <h2>Install the terminal CLI.</h2>
          <p>
            Step 1 already left a working CLI at <code>node packages/cli/dist/index.js</code>. To
            get a global <code>adwarp</code> command instead of the long node path. Coming from
            Liam? <code>liam</code> still works as an alias for <code>adwarp</code>, so existing
            scripts and cron jobs keep running.
          </p>
          <pre className="code" tabIndex={0}>{`cd packages/cli && pnpm link --global
adwarp accounts list

# A sensible first session:
adwarp targeting search titles "demand generation"   # resolve targeting URNs
adwarp report summary -p last_30_days                # account rollup + flags
adwarp launch --brief examples/brief.json            # creates DRAFTS only`}</pre>
        </section>

        <section id="tools" className="section">
          <p className="kicker">Tools · MCP</p>
          <h2>Every tool the server exposes.</h2>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Area</th>
                  <th>Tools</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Accounts</td>
                  <td>
                    <code>list_ad_accounts</code>
                  </td>
                </tr>
                <tr>
                  <td>Targeting</td>
                  <td>
                    <code>list_targeting_facets</code>, <code>search_targeting</code> (typeahead a
                    facet for entity URNs), <code>list_facet_entities</code>,{" "}
                    <code>estimate_audience</code>. Talk in plain language and Adwarp resolves the
                    facets, estimates reach, then builds the campaign.
                  </td>
                </tr>
                <tr>
                  <td>Audiences</td>
                  <td>
                    <code>upload_audience_csv</code> (auto-cleans the CSV: normalizes columns,
                    hashes emails, converts company domains to URLs; contact and company lists),{" "}
                    <code>audience_from_salesforce</code> (SOQL to matched audience),{" "}
                    <code>get_audience_status</code>
                  </td>
                </tr>
                <tr>
                  <td>Conversions</td>
                  <td>
                    <code>list_conversions</code>. Campaign creation accepts{" "}
                    <code>conversionIds</code> or <code>conversionName</code>, falling back to the
                    config default.
                  </td>
                </tr>
                <tr>
                  <td>Campaigns</td>
                  <td>
                    <code>create_campaign_group</code>, <code>create_campaign</code>,{" "}
                    <code>create_text_ad</code>, <code>create_image_ad</code>,{" "}
                    <code>list_campaigns</code> (drafts included, unlike reporting),{" "}
                    <code>list_ads</code>, <code>delete_ad</code>. LinkedIn ignores post edits on
                    a live ad, so to change copy you recreate: delete plus create.
                  </td>
                </tr>
                <tr>
                  <td>Orchestrator</td>
                  <td>
                    <code>launch_from_brief</code> (audience + group + campaign + draft creatives
                    in one call)
                  </td>
                </tr>
                <tr>
                  <td>Reporting</td>
                  <td>
                    <code>performance_summary</code>, <code>get_performance</code>,{" "}
                    <code>performance_trend</code>. KPIs: CTR, CPC, CPM, CPL, conversion rate,
                    cost per conversion.
                  </td>
                </tr>
                <tr>
                  <td>Competitor intel</td>
                  <td>
                    <code>inspect_competitor_ads</code>: read any company&apos;s ads from the
                    LinkedIn Ad Library. Engines: <code>api</code> (metadata, works hosted),{" "}
                    <code>scraper</code> (ad copy via local browser), <code>auto</code> (both).
                  </td>
                </tr>
                <tr>
                  <td>Change journal</td>
                  <td>
                    <code>log_ad_change</code>, <code>list_ad_changes</code>,{" "}
                    <code>compute_lift</code> (before vs after performance for each recorded
                    change)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <h3>Targeting spec</h3>
          <p>
            Structured targeting uses short facet names mapped to entity URNs (resolve URNs with{" "}
            <code>search_targeting</code>). URNs within a facet are ORed; facets are ANDed;
            excluded facets are ORed.
          </p>
          <pre className="code" tabIndex={0}>{`{ "include": { "locations": ["urn:li:geo:103644278"], "seniorities": ["urn:li:seniority:7"] },
  "exclude": { "industries": ["urn:li:industry:47"] } }`}</pre>
        </section>

        <section id="cli-reference" className="section">
          <p className="kicker">CLI reference</p>
          <h2>The full CLI reference.</h2>
          <pre className="code" tabIndex={0}>{`adwarp auth login                         # OAuth, stores tokens in ~/.liads
adwarp auth export                        # print env vars for a self-hosted (Vercel) server
adwarp auth export --mcp                  # print the hosted-MCP connect command with your headers
adwarp accounts list                      # list accessible ad accounts
adwarp targeting search <facet> <query>   # typeahead a facet for entity URNs
adwarp targeting estimate <facet> <urns>  # audience size for one facet's URNs
adwarp audience upload -n <name> -f <csv> # clean + upload a CSV as a matched audience
adwarp audience upload ... --dry-run      # preview the cleaned CSV, no upload
adwarp audience from-salesforce -n <name> -q "<SOQL>"   # Salesforce query -> matched audience
adwarp audience status <segmentId>        # matching status + resolved size
adwarp conversions list                   # account conversions (pick one to track)
adwarp campaigns list [--group <id>]      # campaign groups + ad groups, drafts included
adwarp ad list <campaignId>               # ads in an ad group, drafts included
adwarp ad delete <creativeId>             # delete an ad (creative + its DSC post)
adwarp report summary [-p <period>]       # account rollup: totals, top performers, flags
adwarp report perf <level> [--parent <id>] # per-entity KPI rows
adwarp report trend <level> <id> [-b weekly|monthly]  # trend with deltas
adwarp launch --brief <brief.json>        # audience + group + campaign + draft creatives
adwarp competitor ads <advertiser>        # any company's ads from the public Ad Library
adwarp changelog list [-t <type>] [-i <id>]           # recorded ad changes, newest first
adwarp changelog add -t <type> -i <id> -f <field> --after <v>   # log a change made elsewhere
adwarp lift <level> <id> [-w <days>]      # before vs after performance per recorded change

# Periods: last_7_days, last_30_days, last_90_days, month_to_date, last_month.
# --account defaults to defaultAccountId from config where applicable.`}</pre>
        </section>

        <section id="skills" className="section">
          <p className="kicker">Skills</p>
          <h2>Playbooks on top of Adwarp.</h2>
          <p>
            The{" "}
            <a href={`${REPO}/tree/main/skills`} target="_blank" rel="noreferrer">
              skills directory
            </a>{" "}
            ships ten portable agent skills that turn Adwarp&apos;s raw tools into opinionated
            workflows. Each encodes a methodology: what to pull, how to judge it, significance
            floors, caveats, and a fixed report format. Analysis and monitoring skills are
            read-only; the operating skills create drafts only, after confirmation.
          </p>
          <ul>
            <li>
              <b>Analyze</b>: liam-spend, liam-performance, liam-leads, liam-competitors
            </li>
            <li>
              <b>Monitor</b>: liam-weekly (fixed-format weekly digest), liam-health
              (silent-unless-fire daily guardrails)
            </li>
            <li>
              <b>Operate</b>: liam-launch, liam-experiments, liam-audiences, liam-account-audit
            </li>
          </ul>
          <pre className="code" tabIndex={0}>{`./skills/install.sh   # symlinks them into ~/.claude/skills (Claude Code personal skills)`}</pre>
        </section>

        <section id="journal" className="section">
          <p className="kicker">Change journal &amp; lift</p>
          <h2>Every change is journaled, so lift is measurable.</h2>
          <p>
            Adwarp keeps an append-only journal of every change made to an ad entity, so you can
            measure how performance differed in the window before a change versus after it.
          </p>
          <ul>
            <li>
              <b>Where it lives</b>: <code>~/.liads/changelog.jsonl</code>, a plain local file.
              No database, no account, no setup.
            </li>
            <li>
              <b>Auto-capture</b>: every create or update Adwarp makes is journaled at one HTTP
              chokepoint, so it can&apos;t be forgotten.
            </li>
            <li>
              <b>Manual entries</b>: log changes made in Campaign Manager, or attach a
              hypothesis, with <code>adwarp changelog add</code> and a label naming the test.
            </li>
            <li>
              <b>Lift</b>: <code>adwarp lift &lt;level&gt; &lt;id&gt;</code> compares the window
              before each change (default 14 days) against the window after, with per-metric
              deltas.
            </li>
          </ul>
          <p>
            This is a directional pre and post comparison, not a controlled experiment. It is
            confounded by seasonality, the LinkedIn learning phase after an edit, and concurrent
            budget changes, so treat the deltas as a signal.
          </p>
        </section>

        <section id="configuration" className="section">
          <p className="kicker">Configuration</p>
          <h2>One small config file.</h2>
          <p>
            Local config lives in <code>~/.liads/config.json</code> (mode 0600, never in the
            repo). OAuth tokens are stored separately in <code>~/.liads/credentials.json</code>.
            Hosted equivalents are the <code>LIADS_*</code> env vars plus{" "}
            <code>MCP_AUTH_TOKEN</code>.
          </p>
          <div className="tblwrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>clientId</code>, <code>clientSecret</code>
                  </td>
                  <td>LinkedIn app credentials</td>
                </tr>
                <tr>
                  <td>
                    <code>linkedinVersion</code>
                  </td>
                  <td>
                    pinned API version, e.g. <code>202605</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>defaultAccountId</code>
                  </td>
                  <td>ad account used when a command or brief omits one</td>
                </tr>
                <tr>
                  <td>
                    <code>defaultConversionName</code>
                  </td>
                  <td>conversion auto-selected for new campaigns when none is given</td>
                </tr>
                <tr>
                  <td>
                    <code>mcpAuthToken</code>
                  </td>
                  <td>bearer secret for a self-hosted MCP endpoint</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="salesforce" className="section">
          <p className="kicker">Salesforce</p>
          <h2>From a Salesforce query to a matched audience.</h2>
          <p>
            Adwarp reads Salesforce by shelling out to the authenticated <code>sf</code> CLI, so it
            reuses your existing login and needs no new credentials. Give it a SOQL query that
            selects an email column and it becomes a matched audience, closing the loop from
            &quot;accounts flagged in Salesforce&quot; to &quot;LinkedIn targeting&quot;.
          </p>
          <pre className="code" tabIndex={0}>{`adwarp audience from-salesforce -n "Q3 target accounts" \\
  -q "SELECT Email FROM Contact WHERE Account.Target_List__c = true AND Email != null"`}</pre>
        </section>

        <section id="safety" className="section">
          <p className="kicker">Safety</p>
          <h2>The safety rules.</h2>
          <ul>
            <li>
              Every campaign and creative is created DRAFT or PAUSED. Activation is a separate,
              explicit step you take in Campaign Manager.
            </li>
            <li>
              Matched-audience matching takes up to 48 hours, and a campaign needs about 300
              matched members to serve.
            </li>
            <li>
              LinkedIn does not expose person-level ad-view data; cross-referencing is account and
              segment level.
            </li>
            <li>
              Secrets never enter the repo. Local: <code>~/.liads</code>. Hosted: your Vercel env
              vars, or headers you control.
            </li>
          </ul>
        </section>
      </main>

      <footer className="footer">
        <span>Unofficial. Not affiliated with or endorsed by LinkedIn.</span>
        <span style={{ display: "inline-flex", gap: 24 }}>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            github.com/adwarp-dev/adwarp ↗
          </a>
        </span>
      </footer>
    </div>
  );
}
