/**
 * Pausing, resuming, and archiving a single ad: what updateAd sends to LinkedIn,
 * and that the change journal records it under the ad's numeric id.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first). Every request goes
 * to a fake client or a stubbed fetch, so no credentials are needed and no ad
 * account is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { updateAd, AdUpdateSchema, LinkedInClient, recordMutation, interpretMutation } = await import('../dist/index.js');

function fakeClient() {
  const calls = [];
  return { calls, request: async (req) => { calls.push(req); return { data: undefined, status: 204 }; } };
}

const ENCODED_URN = 'urn%3Ali%3AsponsoredCreative%3A42';

test('status is required and limited to ACTIVE, PAUSED, or ARCHIVED', () => {
  for (const status of ['ACTIVE', 'PAUSED', 'ARCHIVED']) {
    assert.equal(AdUpdateSchema.parse({ creativeId: '42', status }).status, status);
  }
  assert.throws(() => AdUpdateSchema.parse({ creativeId: '42' }), 'no default status, so nothing switches on by omission');
  assert.throws(() => AdUpdateSchema.parse({ creativeId: '42', status: 'DRAFT' }));
  assert.throws(() => AdUpdateSchema.parse({ creativeId: '42', status: 'paused' }));
  assert.equal(AdUpdateSchema.parse({ creativeId: '42', status: 'PAUSED' }).dryRun, false);
});

test('updateAd dry run returns the patch and sends nothing', async () => {
  const client = fakeClient();
  const res = await updateAd(client, { accountId: '1', creativeId: '42', status: 'ACTIVE', dryRun: true });
  assert.deepEqual(res, {
    creativeId: 'urn:li:sponsoredCreative:42',
    intendedStatus: 'ACTIVE',
    dryRun: true,
    patch: { intendedStatus: 'ACTIVE' },
  });
  assert.equal(client.calls.length, 0);
});

test('updateAd sends a PARTIAL_UPDATE of intendedStatus to the encoded creative URN', async () => {
  for (const creativeId of ['42', 'urn:li:sponsoredCreative:42']) {
    const client = fakeClient();
    const res = await updateAd(client, { accountId: '1', creativeId, status: 'PAUSED', dryRun: false });
    assert.deepEqual(res, { creativeId: 'urn:li:sponsoredCreative:42', intendedStatus: 'PAUSED' });
    assert.equal(client.calls.length, 1);
    const [call] = client.calls;
    assert.equal(call.method, 'POST');
    assert.equal(call.path, `/adAccounts/1/creatives/${ENCODED_URN}`);
    assert.equal(call.headers['X-RestLi-Method'], 'PARTIAL_UPDATE');
    assert.deepEqual(call.body, { patch: { $set: { intendedStatus: 'PAUSED' } } });
  }
});

test('a status change through the HTTP chokepoint is journaled under the numeric creative id', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'adwarp-ad-status-'));
  const journal = join(dir, 'changelog.jsonl');
  const savedPath = process.env.ADWARP_CHANGELOG_PATH;
  const savedFetch = globalThis.fetch;
  process.env.ADWARP_CHANGELOG_PATH = journal;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(null, { status: 204 });
  };
  t.after(() => {
    globalThis.fetch = savedFetch;
    if (savedPath === undefined) delete process.env.ADWARP_CHANGELOG_PATH;
    else process.env.ADWARP_CHANGELOG_PATH = savedPath;
    rmSync(dir, { recursive: true, force: true });
  });

  const client = new LinkedInClient({ clientId: 'id', clientSecret: 'secret', linkedinVersion: '202605' }, async () => 'token', recordMutation);
  await updateAd(client, { accountId: '1', creativeId: '42', status: 'PAUSED', dryRun: false });

  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, `https://api.linkedin.com/rest/adAccounts/1/creatives/${ENCODED_URN}`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['X-RestLi-Method'], 'PARTIAL_UPDATE');
  assert.equal(init.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.equal(init.headers['LinkedIn-Version'], '202605');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { patch: { $set: { intendedStatus: 'PAUSED' } } });

  const lines = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  const [event] = lines;
  assert.equal(event.platform, 'linkedin');
  assert.equal(event.source, 'adwarp');
  assert.equal(event.kind, 'update');
  assert.deepEqual(event.entity, { type: 'creative', id: '42', accountId: '1' });
  assert.deepEqual(event.fields, [{ field: 'intendedStatus', after: 'PAUSED' }]);
  assert.equal(event.summary, 'intendedStatus → PAUSED');
});

test('a creative create is journaled under the same numeric id as its later status changes', () => {
  const created = interpretMutation({
    method: 'POST',
    path: '/adAccounts/1/creatives',
    body: { creative: { name: 'Headline test' } },
    status: 201,
    restliId: 'urn:li:sponsoredCreative:42',
  });
  assert.deepEqual(created.entity, { type: 'creative', id: '42', name: 'Headline test', accountId: '1' });

  const campaign = interpretMutation({
    method: 'POST',
    path: '/adAccounts/1/adCampaigns/7',
    body: { patch: { $set: { status: 'PAUSED' } } },
    status: 204,
  });
  assert.deepEqual(campaign.entity, { type: 'campaign', id: '7', accountId: '1' });
});
