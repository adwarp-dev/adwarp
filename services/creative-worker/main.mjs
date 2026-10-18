import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Store } from './store.mjs';
import { Runner } from './runner.mjs';
import { createWorkerServer } from './server.mjs';

if (process.platform !== 'linux' || (process.env.ADWARP_CREATIVE_WORKER || process.env.LIADS_CREATIVE_WORKER) !== '1') throw new Error('Start the creative worker only in its remote Linux container.');
const data = process.env.WORKER_DATA_DIR || '/data';
mkdirSync(`${data}/screenshots`,{ recursive:true, mode:0o700 });
const store = new Store(`${data}/worker.sqlite`);
const owner = randomUUID();
store.acquire(owner);
const { collectCreative } = await import('./browser.mjs');
const runner = new Runner(store,id => collectCreative(id,store,`${data}/screenshots`));
const server = createWorkerServer(store,process.env.ADWARP_CREATIVE_WORKER_TOKEN || process.env.LIADS_CREATIVE_WORKER_TOKEN,`${data}/screenshots`);
let stopping = false;
let current = Promise.resolve();
const timer = setInterval(() => {
  if (!stopping && !runner.active) current = runner.tick().catch(() => { store.block('Worker storage or execution error; operator review required.'); });
},1000);
server.listen(8080,'0.0.0.0');
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close();
  await current;
  store.release(owner);
  store.close();
});
