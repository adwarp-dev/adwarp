import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";
import type { CredentialStore, StoredCredentials } from "./credentials.js";

/** Supplies a valid (auto-refreshed) bearer token to a platform HTTP client. */
export type TokenProvider = () => Promise<string>;

/**
 * Everything that differs between one OAuth provider and the next. The flow
 * itself (spin a localhost callback, open the consent screen, exchange the
 * code, refresh on expiry) is identical for LinkedIn and Google, so it lives
 * here once and each platform supplies this descriptor.
 */
export interface OauthProvider {
  /** Shown in errors and on the browser success page, e.g. "LinkedIn". */
  name: string;
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Must exactly match a redirect URI registered on the provider's app. */
  redirectUri: string;
  /** Port `redirectUri` points at; the login server listens here. */
  callbackPort: number;
  scopes: string[];
  /**
   * Extra authorization-URL params. Google needs `access_type=offline` and
   * `prompt=consent` or it returns no refresh token on re-authorization.
   */
  extraAuthParams?: Record<string, string>;
  /** Separator for the scope param. Both providers use a space today. */
  scopeSeparator?: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
}

function toCredentials(t: TokenResponse): StoredCredentials {
  const now = Date.now();
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: now + t.expires_in * 1000,
    refreshExpiresAt: t.refresh_token_expires_in ? now + t.refresh_token_expires_in * 1000 : undefined,
    scope: t.scope,
  };
}

async function postToken(tokenUrl: string, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/**
 * Interactive 3-legged OAuth: spins a localhost callback server, opens the
 * browser to the consent screen, captures the code, exchanges it, and persists
 * tokens to the given store. Returns the granted credentials (scope included,
 * so callers can report what was actually granted).
 */
export async function oauthLogin(provider: OauthProvider, store: CredentialStore): Promise<StoredCredentials> {
  const state = randomBytes(16).toString("hex");

  const authUrl = new URL(provider.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", provider.clientId);
  authUrl.searchParams.set("redirect_uri", provider.redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", provider.scopes.join(provider.scopeSeparator ?? " "));
  for (const [k, v] of Object.entries(provider.extraAuthParams ?? {})) {
    authUrl.searchParams.set(k, v);
  }

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, provider.redirectUri);
      const returnedState = url.searchParams.get("state");
      const returnedCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (error) {
        res.end(`<h2>Authorization failed: ${error}</h2><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`Authorization denied: ${error}`));
        return;
      }
      if (returnedState !== state) {
        res.end("<h2>State mismatch, possible CSRF. Aborted.</h2>");
        server.close();
        reject(new Error("OAuth state mismatch"));
        return;
      }
      res.end(`<h2>${provider.name} connected.</h2><p>You can close this tab and return to the terminal.</p>`);
      server.close();
      resolve(returnedCode!);
    });
    server.on("error", reject);
    server.listen(provider.callbackPort, () => {
      void open(authUrl.toString());
    });
  });

  const tokens = await postToken(provider.tokenUrl, {
    grant_type: "authorization_code",
    code,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    redirect_uri: provider.redirectUri,
  });
  const creds = toCredentials(tokens);
  await store.save(creds);
  return creds;
}

/** Exchange a refresh token for a fresh access token and persist the result. */
export async function refreshCredentials(
  provider: Pick<OauthProvider, "tokenUrl" | "clientId" | "clientSecret">,
  refreshToken: string,
  store: CredentialStore,
): Promise<StoredCredentials> {
  const tokens = await postToken(provider.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
  });
  // Neither provider reliably echoes the refresh token back; keep the existing one.
  const creds = toCredentials(tokens);
  if (!creds.refreshToken) creds.refreshToken = refreshToken;
  await store.save(creds);
  return creds;
}

/** Refresh if the access token expires within this window (ms). */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * Builds a TokenProvider: loads stored credentials once, then on every call
 * returns a live access token, refreshing it when near expiry. `reloginHint` is
 * the platform-specific instruction shown when re-authorization is unavoidable.
 */
export async function createOauthTokenProvider(opts: {
  provider: Pick<OauthProvider, "tokenUrl" | "clientId" | "clientSecret">;
  store: CredentialStore;
  reloginHint: string;
}): Promise<TokenProvider> {
  let creds = await opts.store.load();
  if (!creds) throw new Error(`Not authenticated. ${opts.reloginHint}`);

  return async () => {
    if (creds!.accessToken && Date.now() < creds!.expiresAt - REFRESH_SKEW_MS) {
      return creds!.accessToken;
    }
    if (creds!.refreshToken && (!creds!.refreshExpiresAt || Date.now() < creds!.refreshExpiresAt)) {
      creds = await refreshCredentials(opts.provider, creds!.refreshToken, opts.store);
      return creds.accessToken;
    }
    throw new Error(`Access token expired and no valid refresh token. ${opts.reloginHint}`);
  };
}
