import Link from "next/link";

const REPO = "https://github.com/adwarp-dev/adwarp";
const UPDATED = "4 August 2026";

export const metadata = {
  title: "Terms of Service · Adwarp",
  description:
    "The terms covering the Adwarp website, the hosted MCP endpoint, and the open-source tool: what it does, what you are responsible for, and the limits of the warranty.",
};

export default function Terms() {
  return (
    <div className="wrap docs">
      <header className="topbar reveal d1">
        <span>
          <b>
            <Link href="/" style={{ color: "inherit", textDecoration: "none", border: "none" }}>
              ADWARP
            </Link>
          </b>{" "}
          · TERMS OF SERVICE
        </span>
        <nav className="topnav">
          <a href="/docs">DOCS</a>
          <a href="/privacy">PRIVACY</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
      </header>

      <main>
        <header className="dochead">
          <h1 className="docmark reveal d1">Terms of Service</h1>
          <p className="lede reveal d2">
            These terms cover three things that share the name Adwarp: this website, the hosted MCP
            endpoint at <code>/api/mcp</code>, and the open-source tool you run yourself. Last
            updated {UPDATED}.
          </p>
        </header>

        <section className="section">
          <p className="kicker">What Adwarp is</p>
          <h2>An ad manager you run against your own accounts.</h2>
          <p>
            Adwarp creates and reports on advertising campaigns on LinkedIn and Google Ads. It is
            operated by Default (default.com). The source is published under the MIT licence at{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              github.com/adwarp-dev/adwarp
            </a>
            , and you are free to read, fork, and self-host it on those terms.
          </p>
          <p>
            Adwarp is not affiliated with, endorsed by, or sponsored by LinkedIn or Google. It calls
            their public APIs using credentials you supply.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Your accounts</p>
          <h2>You bring your own credentials, and they stay yours.</h2>
          <p>
            Adwarp has no advertising accounts of its own. Everything it does runs against the ad
            accounts you authenticate, using a developer application you register with the platform
            and an OAuth grant you approve. You are responsible for keeping those credentials
            secret and for revoking them if they are exposed.
          </p>
          <p>
            You may only use Adwarp against accounts you own or are authorised to operate, and your
            use must comply with the terms of the platform you are calling, including the LinkedIn
            Marketing API terms and the Google Ads API Terms of Service and policies. If those
            terms conflict with these, theirs govern your use of their API.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Spend</p>
          <h2>Adwarp does not activate anything, and you own what it costs.</h2>
          <p>
            By design, everything Adwarp creates is inert: LinkedIn entities are created as drafts,
            Google entities as paused, and there is deliberately no command or tool that can enable
            them. Turning a campaign on is a separate action you take yourself in Campaign Manager
            or the Google Ads interface.
          </p>
          <p>
            That is a safeguard, not a guarantee. You remain solely responsible for every campaign
            you activate, every budget you set, and all advertising spend on your accounts. Review
            what Adwarp has built before you switch it on.
          </p>
        </section>

        <section className="section">
          <p className="kicker">The hosted endpoint</p>
          <h2>Provided as a convenience, with no uptime promise.</h2>
          <p>
            The hosted MCP endpoint is offered free and as a convenience. It may change, rate-limit,
            or stop entirely at any time without notice. Do not build anything you depend on around
            its availability; if you need it to be reliable, self-host it. Automated abuse, attempts
            to reach accounts you do not control, and use that degrades the service for others are
            not permitted, and access may be withdrawn.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Warranty and liability</p>
          <h2>No warranty.</h2>
          <p>
            Adwarp is provided &ldquo;as is&rdquo;, without warranty of any kind, express or implied,
            including but not limited to the warranties of merchantability, fitness for a particular
            purpose, and noninfringement. It automates a system that spends money, and it can be
            wrong: an API can change, a report can mislead, and a brief can be misread.
          </p>
          <p>
            To the fullest extent permitted by law, Default is not liable for any claim, damages,
            or other liability arising from your use of Adwarp, including advertising spend, lost
            revenue, lost data, or campaigns that performed other than you hoped. Verify before you
            activate.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Changes and contact</p>
          <h2>Getting in touch.</h2>
          <p>
            We may update these terms. Material changes will be reflected in the date at the top of
            this page, and the history is public in the repository. Continuing to use Adwarp after a
            change means you accept it.
          </p>
          <p>
            Questions about these terms: <a href="mailto:stan@default.com">stan@default.com</a>.
            Bugs and feature requests are better raised as an issue on{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="footer">
        <span>Unofficial. Not affiliated with or endorsed by LinkedIn or Google.</span>
        <span style={{ display: "inline-flex", gap: 24 }}>
          <a href="/docs">Docs</a>
          <a href="/privacy">Privacy</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            github.com/adwarp-dev/adwarp ↗
          </a>
        </span>
      </footer>
    </div>
  );
}
