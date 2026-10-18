import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAdLibrary,fetchAdCopyByIds,scanCompetitorAds,getRemoteCreatives } from '../dist/index.js';

test('all old local scraper entrypoints fail closed before network access', async () => {
  await assert.rejects(scanAdLibrary({advertiser:'Ramp'}),/disabled/);
  await assert.rejects(fetchAdCopyByIds(['123']),/disabled/);
  await assert.rejects(scanCompetitorAds({advertiser:'Ramp',engine:'scraper'}),/removed/);
  await assert.rejects(scanCompetitorAds({companyId:'123'}),/Provide an advertiser/);
});
test('remote failures never trigger browser or second request; redirects forbidden', async t => {
  const previous = globalThis.fetch;
  const url = process.env.ADWARP_CREATIVE_WORKER_URL;
  const token = process.env.ADWARP_CREATIVE_WORKER_TOKEN;
  t.after(()=> { globalThis.fetch=previous; if(url===undefined) delete process.env.ADWARP_CREATIVE_WORKER_URL; else process.env.ADWARP_CREATIVE_WORKER_URL=url; if(token===undefined) delete process.env.ADWARP_CREATIVE_WORKER_TOKEN; else process.env.ADWARP_CREATIVE_WORKER_TOKEN=token; });
  process.env.ADWARP_CREATIVE_WORKER_URL='https://worker.example'; process.env.ADWARP_CREATIVE_WORKER_TOKEN='test-token';
  let calls=0;
  globalThis.fetch=async (_url,opts)=> { calls++; assert.equal(opts.redirect,'error'); return {ok:false,status:503}; };
  await assert.rejects(getRemoteCreatives(['123'],true),/503/); assert.equal(calls,1);
  process.env.ADWARP_CREATIVE_WORKER_URL='http://worker.example';
  await assert.rejects(getRemoteCreatives(['123']),/HTTPS/); assert.equal(calls,1);
});
