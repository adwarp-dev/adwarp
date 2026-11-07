/**
 * The create_post_ad tool over the MCP protocol: it is registered for the local
 * server and the hosted endpoint, its input schema is the one documented, and a
 * bad post URN is refused before any credentials load or LinkedIn call.
 *
 * Runs against dist (`pnpm --filter @adwarp/mcp... build` first). No call here
 * reaches LinkedIn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const { registerTools } = await import('../dist/tools.js');

async function connect(options) {
  const server = new McpServer({ name: 'adwarp-test', version: '0.0.0' });
  registerTools(server, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'adwarp-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('create_post_ad is registered locally and on the hosted endpoint', async () => {
  for (const options of [undefined, { google: false, hubspot: false }]) {
    const { client, close } = await connect(options);
    try {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === 'create_post_ad');
      assert.ok(tool, `registered with ${JSON.stringify(options)}`);
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['accountId', 'campaignId', 'name', 'postUrn', 'status']);
      assert.deepEqual(tool.inputSchema.required.sort(), ['campaignId', 'postUrn']);
      assert.equal(tool.inputSchema.properties.status.default, 'DRAFT');
      assert.match(tool.description, /approve/);
      assert.match(tool.description, /DRAFT by default/);
      assert.doesNotMatch(tool.description, /—/, 'no em dashes');
    } finally {
      await close();
    }
  }
});

test('create_post_ad refuses an activity URN before any network call', async (t) => {
  const savedFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error(`unexpected fetch ${url}`);
  };
  t.after(() => {
    globalThis.fetch = savedFetch;
  });
  const { client, close } = await connect({ google: false, hubspot: false });
  try {
    const res = await client.callTool({
      name: 'create_post_ad',
      arguments: { campaignId: '7', postUrn: 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/' },
    });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /activity 7123456789012345678, not a post URN/);
    assert.match(res.content[0].text, /Embed this post/);
    assert.deepEqual(requests, []);
  } finally {
    await close();
  }
});
