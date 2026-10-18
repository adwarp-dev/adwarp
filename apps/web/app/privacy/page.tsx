import Link from "next/link";

const REPO = "https://github.com/adwarp-dev/adwarp";
const UPDATED = "4 August 2026";

export const metadata = {
  title: "Privacy Policy · Adwarp",
  description:
    "What Adwarp accesses, where it is stored, and what is never collected. Credentials and ad data stay on your machine; the hosted endpoint holds them in memory for the length of a request and nothing longer.",
};

export default function Privacy() {
  return (
    <div className="wrap docs">
      <header className="topbar reveal d1">
        <span>
          <b>
            <Link href="/" style={{ color: "inherit", textDecoration: "none", border: "none" }}>
              ADWARP
            </Link>
          </b>{" "}
          · PRIVACY POLICY
        </span>
        <nav className="topnav">
          <a href="/docs">DOCS</a>
          <a href="/terms">TERMS</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            GITHUB
          </a>
        </nav>
      </header>

      <main>
        <header className="dochead">
          <h1 className="docmark reveal d1">Privacy Policy</h1>
          <p className="lede reveal d2">
            Adwarp is a tool you run against your own advertising accounts.{" "}
            <em>It has no user accounts and no database.</em> Your credentials and your ad data stay
            on your machine. Last updated {UPDATED}.
          </p>
        </header>

        <section className="section">
          <p className="kicker">Scope</p>
          <h2>Three things this covers.</h2>
          <ul>
            <li>
              <b>This website</b>, adwarp.dev (formerly liam-mcp.vercel.app), which is documentation.
            </li>
            <li>
              <b>The tool you run locally</b>, the <code>adwarp</code> CLI and the MCP server, on your
              own computer.
            </li>
            <li>
              <b>The hosted MCP endpoint</b> at <code>/api/mcp</code>, which relays requests to
              LinkedIn on behalf of whoever calls it.
            </li>
          </ul>
          <p>
            Adwarp is operated by its maintainer, Stan Rymkiewicz. There is no sign-up, no user
            account, and no profile. We do not know who you are unless you contact us.
          </p>
        </section>

        <section className="section">
          <p className="kicker">The website</p>
          <h2>Anonymous, aggregate page analytics.</h2>
          <p>
            This site uses Vercel Analytics to count page views. It records the page visited, the
            referrer, and coarse device and country information. It does not use cookies, does not
            fingerprint visitors, and does not build a profile that identifies you. That is the only
            analytics on the site, and there is no advertising or tracking pixel of any kind.
          </p>
        </section>

        <section className="section">
          <p className="kicker">The local tool</p>
          <h2>Nothing leaves your machine except calls to the ad platform.</h2>
          <p>
            When you run Adwarp locally, it talks directly from your computer to LinkedIn and Google.
            Nothing is sent to us. There is no telemetry, no usage reporting, and no phone-home of
            any kind in the CLI or the local MCP server.
          </p>
          <p>Everything it stores, it stores on your own disk, in the <code>~/.liads</code> directory:</p>
          <ul>
            <li>
              <b>Application credentials</b> and <b>OAuth tokens</b> for each platform, written with
              owner-only file permissions. These never leave your machine.
            </li>
            <li>
              <b>A change journal</b>, a local log of the campaign changes Adwarp has made, used to
              compare performance before and after a change. It records entity ids and the fields
              that changed. It is a plain file you can read or delete at any time.
            </li>
          </ul>
          <p>
            To revoke Adwarp&rsquo;s access entirely, delete that directory and remove the
            application&rsquo;s access in your{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              Google account permissions
            </a>{" "}
            or LinkedIn settings.
          </p>
        </section>

        <section className="section">
          <p className="kicker">The hosted endpoint</p>
          <h2>Credentials live for the length of one request.</h2>
          <p>
            The hosted MCP endpoint accepts LinkedIn application credentials as request headers and
            uses them to call LinkedIn on your behalf. Those credentials are held in memory only for
            as long as the request needs them. They are never written to disk, never stored in a
            database, and never logged.
          </p>
          <p>
            No campaign data, audience data, or report data passes through storage: results are
            returned to the caller and discarded. We record anonymous request counts for the
            endpoint, specifically the API method name and which tool was called, so we can see
            whether it is working. We never record the arguments to a call or any credential.
          </p>
          <p>
            The Google Ads tools are deliberately not available on the hosted endpoint. Google
            functionality runs only in the local tool, against credentials on your own machine.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Google user data</p>
          <h2>What we access from Google, and what we do with it.</h2>
          <p>
            When you connect a Google account, Adwarp requests a single scope,{" "}
            <code>https://www.googleapis.com/auth/adwords</code>, which grants access to the Google
            Ads accounts your Google user can already reach. We request nothing else: no email,
            profile, contacts, Drive, or Gmail access.
          </p>
          <p>That access is used for exactly three things, all initiated by you:</p>
          <ul>
            <li>Creating paused campaigns, ad groups, keywords, and ads in your own ad accounts.</li>
            <li>Reading performance figures for those campaigns so they can be shown back to you.</li>
            <li>Requesting keyword volume and bid estimates before you commit budget.</li>
          </ul>
          <p>
            Data obtained from Google APIs is used only to provide these features to you, in the
            session in which you asked for them. It is not stored on any server we control, not sold,
            not shared with third parties, not used for advertising, and not used to train any
            machine-learning or artificial-intelligence model. Adwarp&rsquo;s use of information
            received from Google APIs adheres to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </section>

        <section className="section">
          <p className="kicker">LinkedIn data</p>
          <h2>The same rules, with one thing to know about audiences.</h2>
          <p>
            LinkedIn access is used to create campaigns and read reporting on your own ad accounts,
            on the same terms as above.
          </p>
          <p>
            One case deserves naming. If you upload a contact list as a matched audience, Adwarp reads
            that file on your machine, hashes the email addresses with SHA-256 as LinkedIn requires,
            and uploads the hashes directly to LinkedIn. The list is never sent to us, and the
            unhashed addresses never leave your computer. You are responsible for having a lawful
            basis to use that list for advertising.
          </p>
        </section>

        <section className="section">
          <p className="kicker">Third parties</p>
          <h2>Who else is involved.</h2>
          <ul>
            <li>
              <b>LinkedIn</b> and <b>Google</b>, because that is what the tool calls. Their handling
              of your data is governed by their own privacy policies.
            </li>
            <li>
              <b>Vercel</b>, which hosts this website and the MCP endpoint and processes the request
              logs and analytics described above.
            </li>
          </ul>
          <p>We do not sell data, and there is no advertising network on this site.</p>
        </section>

        <section className="section">
          <p className="kicker">Contact</p>
          <h2>Questions, or a request about your data.</h2>
          <p>
            Open an issue on{" "}
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
              github.com/adwarp-dev/adwarp/issues
            </a>
            , and never paste credentials there. Because we hold no user
            accounts and no stored personal data, most requests resolve to deleting your local{" "}
            <code>~/.liads</code> directory and revoking the OAuth grant, both of which are entirely
            in your hands. If this policy changes, the date at the top of the page changes with it,
            and the full history is public in the{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              repository
            </a>
            .
          </p>
        </section>
      </main>

      <footer className="footer">
        <span>Unofficial. Not affiliated with or endorsed by LinkedIn or Google.</span>
        <span style={{ display: "inline-flex", gap: 24 }}>
          <a href="/docs">Docs</a>
          <a href="/terms">Terms</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            github.com/adwarp-dev/adwarp ↗
          </a>
        </span>
      </footer>
    </div>
  );
}
