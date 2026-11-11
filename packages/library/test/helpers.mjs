// Shared test helpers. Tests run against dist (`pnpm --filter @adwarp/library build` first) and never touch the
// network: every adapter gets a fake fetch that answers from test/fixtures.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A fixture's raw text, so tests exercise the same JSON parsing the adapters use. */
export const fixtureText = (name) => readFileSync(join(HERE, "fixtures", name), "utf8");
export const fixture = (name) => JSON.parse(fixtureText(name));

/**
 * A fetch that answers each call with the next response from `answer(url, init, calls)`, and records every call.
 * `answer` returns { status?, body } where body is a string (sent as is) or an object (sent as JSON).
 */
export function fakeFetch(answer) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body } = await answer(String(url), init, calls);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

export const watchlistEntry = {
  name: "Example Software",
  domain: "example.com",
  linkedin: { companyId: "30898036" },
  google: { advertiserIds: ["AR111"] },
  meta: { pageIds: ["111"] },
  tiktok: { businessIds: ["7000000000000000001"] },
};
