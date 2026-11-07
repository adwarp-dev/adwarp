/**
 * Post ads (create_post_ad / `adwarp ad create-post`): sponsoring a post that
 * already exists, such as a member's post for a thought leader ad. Covers how a
 * pasted URN or URL becomes the post URN, why activity URNs are refused, what
 * createPostAd sends to LinkedIn, and that deleteAd never deletes a post the ad
 * only references.
 *
 * Runs against dist (`pnpm --filter @adwarp/core build` first). Every request goes
 * to a fake client, so no credentials are needed and no ad account is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parsePostUrn, createPostAd, deleteAd, PostAdCreativeSchema } = await import('../dist/index.js');

/** Records every request and answers from `respond`, or with a created creative id. */
function fakeClient(respond = () => ({ status: 201, restliId: 'urn:li:sponsoredCreative:42' })) {
  const calls = [];
  return {
    calls,
    request: async (req) => {
      calls.push(req);
      return respond(req);
    },
  };
}

test('a bare ugcPost or share URN passes through', () => {
  assert.equal(parsePostUrn('urn:li:ugcPost:7123456789012345678'), 'urn:li:ugcPost:7123456789012345678');
  assert.equal(parsePostUrn('urn:li:share:7123456789012345678'), 'urn:li:share:7123456789012345678');
  assert.equal(parsePostUrn('  urn:li:share:7123456789012345678\n'), 'urn:li:share:7123456789012345678');
});

test('the post URN is extracted from LinkedIn URLs', () => {
  const cases = [
    ['https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/', 'urn:li:ugcPost:7123456789012345678'],
    ['https://www.linkedin.com/feed/update/urn:li:share:7123456789012345678?utm_source=share', 'urn:li:share:7123456789012345678'],
    ['https://www.linkedin.com/embed/feed/update/urn:li:share:7123456789012345678?collapsed=1', 'urn:li:share:7123456789012345678'],
    ['https://www.linkedin.com/feed/update/urn%3Ali%3AugcPost%3A7123456789012345678/', 'urn:li:ugcPost:7123456789012345678'],
    ['https://www.linkedin.com/feed/update/urn%253Ali%253Ashare%253A7123456789012345678', 'urn:li:share:7123456789012345678'],
    ['<iframe src="https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7123456789012345678" height="600"></iframe>', 'urn:li:ugcPost:7123456789012345678'],
    ['https://www.linkedin.com/feed/update/urn:li:ugcpost:7123456789012345678/', 'urn:li:ugcPost:7123456789012345678'],
  ];
  for (const [input, expected] of cases) assert.equal(parsePostUrn(input), expected, input);
});

test('activity URNs are refused with directions to the post URN', () => {
  const inputs = [
    'urn:li:activity:7123456789012345678',
    'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/',
    'https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7123456789012345678/',
    'https://www.linkedin.com/posts/jane-doe_launch-day-activity-7123456789012345678-AbCd',
  ];
  for (const input of inputs) {
    assert.throws(
      () => parsePostUrn(input),
      (err) => {
        assert.match(err.message, /activity 7123456789012345678, not a post URN/);
        assert.match(err.message, /no documented way/);
        assert.match(err.message, /Embed this post/);
        assert.match(err.message, /urn:li:ugcPost: or urn:li:share:/);
        return true;
      },
      input,
    );
  }
});

test('input without any post URN is refused', () => {
  for (const input of ['', 'hello', 'https://www.linkedin.com/in/jane-doe/', 'urn:li:sponsoredCreative:42']) {
    assert.throws(() => parsePostUrn(input), /no LinkedIn post URN/, input);
  }
});

test('the schema defaults status to DRAFT and allows only DRAFT, ACTIVE, or PAUSED', () => {
  const parsed = PostAdCreativeSchema.parse({ campaignId: '7', postUrn: 'urn:li:share:1' });
  assert.equal(parsed.status, 'DRAFT');
  assert.equal(parsed.accountId, undefined);
  assert.equal(PostAdCreativeSchema.parse({ campaignId: '7', postUrn: 'urn:li:share:1', status: 'PAUSED' }).status, 'PAUSED');
  assert.throws(() => PostAdCreativeSchema.parse({ campaignId: '7', postUrn: 'urn:li:share:1', status: 'ARCHIVED' }));
  assert.throws(() => PostAdCreativeSchema.parse({ campaignId: '7', postUrn: '' }));
  assert.throws(() => PostAdCreativeSchema.parse({ postUrn: 'urn:li:share:1' }), 'campaignId is required');
});

test('createPostAd POSTs a DRAFT creative that references the post', async () => {
  const client = fakeClient();
  const input = PostAdCreativeSchema.parse({
    campaignId: '7',
    postUrn: 'https://www.linkedin.com/feed/update/urn:li:ugcPost:7123456789012345678/',
    name: 'Founder post',
  });
  const res = await createPostAd(client, { ...input, accountId: '511' });
  assert.deepEqual(res, {
    creativeId: 'urn:li:sponsoredCreative:42',
    postUrn: 'urn:li:ugcPost:7123456789012345678',
    status: 'DRAFT',
  });
  assert.equal(client.calls.length, 1);
  const [call] = client.calls;
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/adAccounts/511/creatives');
  assert.equal(call.query, undefined, 'a plain create, not ?action=createInline');
  assert.deepEqual(call.body, {
    campaign: 'urn:li:sponsoredCampaign:7',
    intendedStatus: 'DRAFT',
    content: { reference: 'urn:li:ugcPost:7123456789012345678' },
    name: 'Founder post',
  });
});

test('createPostAd leaves name out when none is given and passes an explicit status', async () => {
  const client = fakeClient();
  await createPostAd(client, { accountId: '511', campaignId: '7', postUrn: 'urn:li:share:99', status: 'PAUSED' });
  assert.deepEqual(client.calls[0].body, {
    campaign: 'urn:li:sponsoredCampaign:7',
    intendedStatus: 'PAUSED',
    content: { reference: 'urn:li:share:99' },
  });
});

test('createPostAd refuses an activity URN without calling LinkedIn', async () => {
  const client = fakeClient();
  await assert.rejects(
    createPostAd(client, { accountId: '511', campaignId: '7', postUrn: 'urn:li:activity:99', status: 'DRAFT' }),
    /not a post URN/,
  );
  assert.equal(client.calls.length, 0);
});

/** A fake LinkedIn for deleteAd: the creative references `postUrn`, and GET /posts answers with `post`. */
function deleteClient(postUrn, post) {
  return fakeClient((req) => {
    if (req.path.startsWith('/adAccounts/511/creatives/') && !req.method) {
      return { status: 200, data: { content: { reference: postUrn } } };
    }
    if (req.path.startsWith('/posts/') && !req.method) {
      if (post instanceof Error) throw post;
      return { status: 200, data: post };
    }
    return { status: 204 };
  });
}
const methods = (client) => client.calls.map((c) => `${c.method ?? 'GET'} ${c.path}`);

test("deleteAd keeps a member's post that the ad only references", async () => {
  const postUrn = 'urn:li:ugcPost:7123456789012345678';
  const client = deleteClient(postUrn, { id: postUrn, author: 'urn:li:person:abc', visibility: 'PUBLIC' });
  const res = await deleteAd(client, '511', '42');
  assert.equal(res.postDeleted, false);
  assert.match(res.postNote, /Left in place/);
  assert.deepEqual(methods(client), [
    'GET /adAccounts/511/creatives/urn%3Ali%3AsponsoredCreative%3A42',
    `GET /posts/${encodeURIComponent(postUrn)}`,
    'DELETE /adAccounts/511/creatives/urn%3Ali%3AsponsoredCreative%3A42',
  ]);
});

test('deleteAd keeps an organic Page post, a dark post from another ad account, and a post it cannot read', async () => {
  const postUrn = 'urn:li:share:55';
  for (const post of [
    { id: postUrn, author: 'urn:li:organization:1' },
    { id: postUrn, author: 'urn:li:organization:1', adContext: { isDsc: true, dscAdAccount: 'urn:li:sponsoredAccount:999' } },
    new Error('403 ACCESS_DENIED'),
  ]) {
    const client = deleteClient(postUrn, post);
    const res = await deleteAd(client, '511', '42');
    assert.equal(res.postDeleted, false);
    assert.ok(!methods(client).some((m) => m.startsWith('DELETE /posts/')), 'never deletes the post');
  }
});

test("deleteAd still deletes the ad account's own Direct Sponsored Content post", async () => {
  const postUrn = 'urn:li:share:55';
  const client = deleteClient(postUrn, {
    id: postUrn,
    author: 'urn:li:organization:1',
    adContext: { isDsc: true, dscAdAccount: 'urn:li:sponsoredAccount:511', dscStatus: 'ACTIVE' },
  });
  const res = await deleteAd(client, '511', 'urn:li:sponsoredCreative:42');
  assert.deepEqual(res, { creativeId: 'urn:li:sponsoredCreative:42', postUrn, postDeleted: true });
  assert.equal(methods(client).at(-1), `DELETE /posts/${encodeURIComponent(postUrn)}`);
});
