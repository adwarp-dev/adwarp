import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, LIMITS } from '../store.mjs';
import { Runner } from '../runner.mjs';
import { assertPageAllowed } from '../browser.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(),'adwarp-worker-'));
  const clock = { at: 1800000000000 };
  const store = new Store(join(dir,'test.sqlite'), () => clock.at);
  t.after(() => { try { store.close(); } catch {} rmSync(dir,{ recursive:true,force:true }); });
  return { store,clock,dir };
}
test('duplicate requests share one job and cached creatives cause no visits', async t => {
  const {store} = fixture(t); let calls = 0;
  store.enqueue(['1','1']); store.enqueue(['1']);
  const runner = new Runner(store,async () => { calls++; return { commentary:'proof' }; });
  await runner.tick(); store.enqueue(['1']); await runner.tick();
  assert.equal(calls,1); assert.equal(store.read(['1']).creatives[0].copy.commentary,'proof');
});
test('overlapping ticks never start overlapping browsers', async t => {
  const {store} = fixture(t); store.enqueue(['1','2']);
  let release; let calls = 0;
  const runner = new Runner(store,async () => { calls++; await new Promise(r => { release=r; }); return {}; });
  const first = runner.tick(); await runner.tick(); assert.equal(calls,1); release(); await first;
});
test('second process is excluded, including after restart until explicit recovery', t => {
  const {store,dir} = fixture(t); store.acquire('first');
  const second = new Store(join(dir,'test.sqlite'));
  assert.throws(() => second.acquire('second'),/locked/);
  store.close(); assert.throws(() => second.acquire('second'),/locked/);
  second.recover(); second.acquire('second'); second.close();
});
test('page budget and pacing survive new commands and store reopen', t => {
  const {store,clock,dir} = fixture(t);
  store.enqueue(['1','2']); assert.equal(store.claim(),'1'); store.finish('1',{});
  assert.equal(store.claim(),undefined);
  clock.at += LIMITS.gapMs; assert.equal(store.claim(),'2'); store.finish('2',{});
  for (let i=2;i<LIMITS.pagesPerDay;i++) { clock.at += LIMITS.gapMs; store.enqueue([String(i+1)]); assert.ok(store.claim()); store.finish(String(i+1),{}); }
  store.enqueue(['999']); clock.at += LIMITS.gapMs; assert.equal(store.claim(),undefined);
  store.close(); const reopened = new Store(join(dir,'test.sqlite'),()=>clock.at);
  assert.equal(reopened.claim(),undefined); clock.at += 86400000; assert.equal(reopened.claim(),'999'); reopened.close();
});
test('every outgoing browser request consumes the durable request budget', t => {
  const {store} = fixture(t);
  for (let i=0;i<LIMITS.requestsPerDay;i++) assert.equal(store.reserveRequest(),true);
  assert.equal(store.reserveRequest(),false); store.enqueue(['1']); assert.equal(store.claim(),undefined);
});
test('block stops pending work and remains after restart; cached results still readable', async t => {
  const {store,dir} = fixture(t); store.enqueue(['1','2']);
  const runner = new Runner(store,async () => { const e = new Error('blocked'); e.name='AdLibraryBlockedError'; throw e; });
  await runner.tick(); assert.equal(store.read(['1']).creatives[0].status,'failed'); assert.equal(store.claim(),undefined);
  store.enqueue(['3']); assert.equal(store.read(['3']).creatives[0].status,'missing');
  store.close(); const reopened = new Store(join(dir,'test.sqlite')); assert.ok(reopened.blocked()); assert.equal(reopened.claim(),undefined); reopened.close();
});
test('HTTP 200 challenge is detected by actual navigation check, not just pure detector', async () => {
  const page = { title:async ()=>'Just a moment...',evaluate:async ()=>'Checking your browser' };
  await assert.rejects(assertPageAllowed(page,200), {name:'AdLibraryBlockedError'});
  await assertPageAllowed({ title:async ()=>'Ad Library',evaluate:async ()=>'Ramp' },200);
});
test('cache expires after seven days and failures have a negative cache', async t => {
  const {store,clock} = fixture(t); store.enqueue(['1']); assert.equal(store.claim(),'1'); store.finish('1',{ commentary:'old' });
  clock.at += LIMITS.cacheMs-1; assert.equal(store.enqueue(['1']).creatives[0].status,'done');
  clock.at += 2; assert.equal(store.enqueue(['1']).creatives[0].status,'pending');
  store.fail('1','failed'); assert.equal(store.enqueue(['1']).creatives[0].status,'failed');
});
test('reject malformed IDs and oversized jobs before queue writes', t => {
  const {store} = fixture(t);
  assert.throws(()=>store.enqueue(['https://example.com']));
  assert.throws(()=>store.enqueue(Array.from({length:11},(_,i)=>String(i))));
  assert.equal(store.read(['1']).creatives[0].status,'missing');
});
