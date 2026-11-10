/**
 * Contact lists with LinkedIn's people-match columns: the cleaner keeps first and last
 * name, company, title and country next to the email, and the upload hashes only the
 * email, as LinkedIn's list-upload spec requires.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first). LinkedIn answers from a
 * fake client and the signed CSV upload from a stubbed fetch, so nothing leaves the process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const { cleanAudienceRows, cleanAudienceCsv, contactListCsv, uploadCleanedAudience } = await import("../dist/index.js");

const UPLOAD_URL = "https://upload.linkedin.test/list";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** A LinkedIn client that records calls and answers the matched-audience upload flow. */
function fakeLinkedIn() {
  const calls = [];
  const client = {
    calls,
    request: async (req) => {
      calls.push(req);
      if (req.query?.action === "generateUploadUrl") return { data: { value: UPLOAD_URL }, status: 200 };
      if (req.path === "/dmpSegments" && req.method === "POST") return { data: undefined, status: 201, restliId: "9001" };
      if (req.path === "/dmpSegments/9001/listUploads") return { data: undefined, status: 201 };
      throw new Error(`Unexpected LinkedIn call: ${req.method} ${req.path}`);
    },
  };
  return { client, getToken: async () => "li-token" };
}

/** Captures the CSV bodies posted to the signed upload URL for a single test. */
function stubUpload(t) {
  const bodies = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input) !== UPLOAD_URL || init.method !== "POST") throw new Error(`Unexpected request: ${input}`);
    bodies.push(init.body);
    return new Response(null, { status: 201, headers: { location: "D4E10AQ" } });
  };
  t.after(() => {
    globalThis.fetch = saved;
  });
  return bodies;
}

test("contact lists keep the people-match columns under LinkedIn's names", () => {
  const clean = cleanAudienceRows([
    { "Work Email": " Ada@Example.com ", "First Name": "Ada", "Last Name": "Lovelace", Company: "Analytical", "Job Title": "VP RevOps", Country: "gb", Notes: "x" },
    { "Work Email": "", "First Name": "Grace", "Last Name": "Hopper", Company: "Navy", "Job Title": "", Country: "United States", Notes: "" },
    { "Work Email": "", "First Name": "Solo", "Last Name": "", Company: "Nowhere", "Job Title": "", Country: "", Notes: "" },
  ]);

  assert.equal(clean.type, "contact");
  assert.deepEqual(clean.columns, ["email", "firstname", "lastname", "employeecompany", "title", "country"]);
  assert.deepEqual(clean.dropped, ["Notes"]);
  assert.deepEqual(clean.rows, [
    { email: "ada@example.com", firstname: "Ada", lastname: "Lovelace", employeecompany: "Analytical", title: "VP RevOps", country: "GB" },
    { firstname: "Grace", lastname: "Hopper", employeecompany: "Navy" },
  ]);
  assert.ok(clean.warnings.some((w) => /1 country value\(s\) were not two-letter ISO codes/.test(w)));
});

test("an email address in a name, company or title column is blanked, since LinkedIn rejects the file", () => {
  const clean = cleanAudienceRows([
    { email: "kate@example.com", firstname: "kate.b@gmail.com", lastname: "", company: "Acme", title: "VP Sales @ Acme" },
    { email: "", firstname: "Ann", lastname: "Lee", company: "ann@acme.io", title: "Head of Ops" },
  ]);
  assert.deepEqual(clean.rows, [
    { email: "kate@example.com", employeecompany: "Acme", title: "VP Sales @ Acme" },
    { firstname: "Ann", lastname: "Lee", title: "Head of Ops" },
  ]);
  assert.ok(clean.warnings.some((w) => /2 name, company or title value\(s\) held an email address/.test(w)));
  assert.ok(!/@[^\s]+\./.test(contactListCsv(clean).csvText));
});

test("a list with names but no email column is a contact list, and `name` is not read as the company", () => {
  const clean = cleanAudienceCsv("firstname,lastname,name,title\nAda,Lovelace,Ada Lovelace,An extremely long job title that runs well past fifty characters\n");
  assert.equal(clean.type, "contact");
  assert.deepEqual(clean.columns, ["firstname", "lastname", "title"]);
  assert.equal(clean.rows[0].title.length, 50);
});

test("a company column on a contact list becomes employeecompany, and other extras are still dropped", () => {
  const clean = cleanAudienceCsv("email,company\nAda@Example.com,Analytical\n", { type: "contact" });
  assert.deepEqual(clean.columns, ["email", "employeecompany"]);
  const emailOnly = cleanAudienceCsv("email,notes\nAda@Example.com,hi\n");
  assert.deepEqual(emailOnly.columns, ["email"]);
  assert.deepEqual(emailOnly.rows, [{ email: "ada@example.com" }]);
});

test("the upload CSV hashes the email, keeps names as text, and dedupes", () => {
  const clean = cleanAudienceRows([
    { email: "ada@example.com", firstname: "Ada", lastname: "Lovelace", company: "Analytical, Ltd" },
    { email: "ADA@example.com", firstname: "Ada", lastname: "Lovelace", company: "Analytical, Ltd" },
    { email: "not-an-email", firstname: "Grace", lastname: "Hopper", company: "Navy" },
    { email: "", firstname: "Grace", lastname: "Hopper", company: "Navy" },
    { email: "broken@", firstname: "", lastname: "", company: "Nobody" },
  ]);
  const list = contactListCsv(clean);

  assert.equal(list.uploaded, 2);
  assert.equal(list.skipped, 1);
  assert.equal(list.nameOnly, 1);
  assert.equal(
    list.csvText,
    `email,firstname,lastname,employeecompany\n${sha256("ada@example.com")},Ada,Lovelace,"Analytical, Ltd"\n,Grace,Hopper,Navy\n`,
  );
});

test("uploading a contact list with names sends one USER_LIST_UPLOAD CSV with no raw email", async (t) => {
  const bodies = stubUpload(t);
  const li = fakeLinkedIn();
  const clean = cleanAudienceRows([
    { email: "ada@example.com", firstname: "Ada", lastname: "Lovelace", title: "VP RevOps" },
    { email: "", firstname: "Grace", lastname: "Hopper", title: "Admiral" },
  ]);

  const res = await uploadCleanedAudience(li.client, li.getToken, { accountId: "123", name: "Emailed", clean });

  assert.equal(res.segmentId, "9001");
  assert.equal(res.audienceType, "contact");
  assert.equal(res.uploaded, 2);
  assert.ok(res.warnings.some((w) => /1 contacts have no valid email and will match on name only/.test(w)));
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0], `email,firstname,lastname,title\n${sha256("ada@example.com")},Ada,Lovelace,VP RevOps\n,Grace,Hopper,Admiral\n`);
  assert.ok(!bodies[0].includes("@"));
  const segment = li.client.calls.find((c) => c.path === "/dmpSegments" && c.body?.name);
  assert.equal(segment.body.type, "USER_LIST_UPLOAD");
});

test("an email-only upload still sends just the hash column", async (t) => {
  const bodies = stubUpload(t);
  const li = fakeLinkedIn();
  const clean = cleanAudienceCsv("email\nAda@Example.com\nada@example.com\nnope\n");

  const res = await uploadCleanedAudience(li.client, li.getToken, { accountId: "123", name: "Emails", clean });

  assert.equal(res.uploaded, 1);
  assert.equal(res.skipped, 1);
  assert.equal(bodies[0], `email\n${sha256("ada@example.com")}\n`);
});
