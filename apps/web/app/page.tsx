import { CopyButton } from "./CopyButton";
import { CLI_SETUP_PROMPT, HOSTED_MCP_SETUP_PROMPT, MCP_SETUP_PROMPT } from "./setupPrompt";

const REPO = "https://github.com/adwarp-dev/adwarp";

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: "Can it spend money without me?",
    a: "No. Everything Adwarp creates is written to LinkedIn as a draft, and there is deliberately no activate command or tool anywhere in the codebase. A campaign starts spending only when you switch it on yourself in Campaign Manager.",
  },
  {
    q: "What permissions does it need?",
    a: "Adwarp runs against your own LinkedIn developer app with the Advertising API product. At login it asks for four OAuth scopes: rw_ads to create and edit campaigns, r_ads_reporting to read performance, rw_conversions for conversion tracking, and w_organization_social so image ads can create the post owned by your LinkedIn Page. Two optional products unlock more: Audiences for CSV list uploads and Ad Library for competitor metadata.",
  },
  {
    q: "How does it work?",
    a: "A CLI and an MCP server sit on top of the same typed client for LinkedIn's Marketing API. You say what you want and your assistant calls the matching tools. Every change Adwarp makes is journaled to a local file so you can measure the lift of any edit later.",
  },
  {
    q: "How do I get started?",
    a: "Copy one of the prompts above into Claude Code. It installs the prerequisites, walks you through creating the LinkedIn app, logs you in through your browser, and verifies everything with a read-only call. The hands-on part takes about 15 minutes; LinkedIn's approval of the Advertising API product can add a day or two of waiting.",
  },
  {
    q: "Do I need to be a developer?",
    a: "No. You need a terminal with Claude Code installed, and the setup prompt does the rest. The hardest part is clicking approve in your browser when LinkedIn asks.",
  },
  {
    q: "Where do my credentials live?",
    a: "In a ~/.liads folder on your own machine, with file permissions locked to your user. Tokens go to LinkedIn's API and nowhere else. Self-hosting the hosted mode puts them in your own Vercel project's environment variables. Connecting to the shared hosted endpoint puts them in your MCP client's config as headers, so they ride along on each call; the server uses them in memory and stores nothing. Self-host if you would rather they never leave your infrastructure.",
  },
  {
    q: "Can I use it without installing anything?",
    a: "Almost. The hosted MCP endpoint lets any MCP client that supports custom headers connect with your own LinkedIn app credentials, so there is nothing to deploy or keep running. You still do one short local run to mint your refresh token, since LinkedIn's OAuth consent has to happen in your browser. After that the connection is a URL plus headers, and a skill or system prompt holds your account defaults.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Adwarp is open source under the MIT license, and there is no hosted service to subscribe to. The only money involved is what you choose to spend on LinkedIn after you activate a campaign.",
  },
  {
    q: "Does it only work with Claude?",
    a: "It works with any MCP client: Claude Code, Claude Desktop, Cursor, and the rest. The CLI needs no assistant at all. Put a weekly report in cron and it runs without one.",
  },
  {
    q: "Is this an official LinkedIn product?",
    a: "No. Adwarp is unofficial and has no affiliation with or endorsement from LinkedIn. It talks to LinkedIn's documented Marketing API through the developer app you create and control.",
  },
];

const USE_CASES: Array<{ q: string; note: string }> = [
  {
    q: "How many VPs of demand gen at US SaaS companies can we reach?",
    note: "Resolves targeting facets and estimates reach before any money is involved.",
  },
  {
    q: "Upload this CSV as a matched audience.",
    note: "Auto-cleans the columns and hashes emails; company domains become website URLs.",
  },
  {
    q: "Build an audience from Salesforce: every contact on a target account.",
    note: "A SOQL query becomes a matched audience, no export step.",
  },
  {
    q: "Launch a draft campaign for that audience, $100 a day.",
    note: "Campaign group, ad group, and draft ads in one call, conversion attached.",
  },
  {
    q: "What ads is HubSpot running, and what offers are they pushing?",
    note: "Reads any company's ads from the public Ad Library: copy, formats, EU targeting.",
  },
  {
    q: "How did retargeting do last month vs the month before?",
    note: "Trend reports with deltas at any level: account, campaign, single ad.",
  },
  {
    q: "Which ads should I pause this week?",
    note: "Account rollup with top and bottom performers, plus flags worth acting on.",
  },
  {
    q: "Rewrite the copy on the losing ad.",
    note: "LinkedIn ignores edits to a live ad's post, so Adwarp recreates it as a fresh draft.",
  },
  {
    q: "Build last month's report: spend, CTR, cost per conversion.",
    note: "Pulls the month's numbers and names the underperformers in one pass.",
  },
];

export default function Home() {
  return (
    <div className="wrap">
      <header className="topbar reveal d1">
        <span>
          <b>ADWARP</b> · LINKEDIN ADS MANAGER
        </span>
        <nav className="topnav">
          <a href="/docs">DOCS</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <h1 className="wordmark reveal d1">ADWARP</h1>

          <p className="tagline reveal d2">
            The <em>LinkedIn Ads Manager</em> you talk to. Describe the campaign in plain language
            and Adwarp drafts the <em>audience</em>, the <em>ad groups</em>, and the <em>ads</em>.
            Works from <em>Claude over MCP</em> or a <em>CLI</em>, locally or through the{" "}
            <em>hosted endpoint</em> with your own LinkedIn app.
          </p>

          <p className="heroLinks reveal d3">
            <a href="#get-started">Get started ↓</a>
            <a href="#use-cases">What it can do ↓</a>
            <a href="#faq">FAQ ↓</a>
            <a href="/docs">Docs →</a>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </p>
        </section>

        <section id="use-cases" className="section">
          <p className="kicker">What you can do</p>
          <h2>Ask it like you would ask a teammate.</h2>
          <div className="grid">
            {USE_CASES.map((u) => (
              <div className="card" key={u.q}>
                <p className="q">
                  <span className="prompt">&gt; </span>
                  {u.q}
                </p>
                <p className="note">{u.note}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="get-started" className="section">
          <p className="kicker">Get started</p>
          <h2>One prompt sets everything up.</h2>
          <p className="sub">
            Pick how you want to use Adwarp and paste the matching prompt into Claude Code. It
            checks your machine, helps you create your own LinkedIn developer app, logs you in,
            and verifies the connection, one step at a time.
          </p>

          <div className="cols">
            <div className="col">
              <h3>Use it as a CLI</h3>
              <p className="note">
                For scripted and batch work in the terminal. Ends with a global <code>adwarp</code>{" "}
                command and your first report.
              </p>
              <div className="promptcard">
                <div className="prompthead">
                  <span>setup prompt · paste into claude code</span>
                  <CopyButton text={CLI_SETUP_PROMPT} />
                </div>
                <pre className="code promptbox" tabIndex={0}>
                  {CLI_SETUP_PROMPT}
                </pre>
              </div>
            </div>
            <div className="col">
              <h3>Talk to it over MCP</h3>
              <p className="note">
                Adds Adwarp as an MCP server in Claude Code, Claude Desktop, or any MCP client.
                The one-time install runs only if it is not on your machine yet.
              </p>
              <div className="promptcard">
                <div className="prompthead">
                  <span>setup prompt · paste into claude code</span>
                  <CopyButton text={MCP_SETUP_PROMPT} />
                </div>
                <pre className="code promptbox" tabIndex={0}>
                  {MCP_SETUP_PROMPT}
                </pre>
              </div>
            </div>
            <div className="col">
              <h3>Use the hosted MCP</h3>
              <p className="note">
                Connect to the hosted endpoint with your own LinkedIn app credentials as
                headers. Every call runs against your ad account; nothing to deploy or keep
                running.
              </p>
              <div className="promptcard">
                <div className="prompthead">
                  <span>setup prompt · paste into claude code</span>
                  <CopyButton text={HOSTED_MCP_SETUP_PROMPT} />
                </div>
                <pre className="code promptbox" tabIndex={0}>
                  {HOSTED_MCP_SETUP_PROMPT}
                </pre>
              </div>
            </div>
          </div>

          <p className="note fine">
            Prefer to do it by hand, or want to self-host the hosted mode on your own Vercel
            account? The <a href="/docs">docs</a> have the full manual walkthrough, the hosted
            header reference, and the permissions table, mirrored from the{" "}
            <a href={`${REPO}#install`} target="_blank" rel="noreferrer">
              README
            </a>
            .
          </p>
        </section>

        <section id="faq" className="section">
          <p className="kicker">FAQ</p>
          <h2>The questions worth asking first.</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p className="a">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Unofficial. Not affiliated with or endorsed by LinkedIn.</span>
        <span style={{ display: "inline-flex", gap: 24 }}>
          <a href="/docs">Docs</a>
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
