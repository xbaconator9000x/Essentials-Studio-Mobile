import test from 'node:test';
import assert from 'node:assert/strict';
import { InFlightImageLoads } from '../src/services/inFlightImageLoads.ts';

test('coalesces many simultaneous requests for one private graphic', async () => {
  const loads = new InFlightImageLoads();
  let started = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = Array.from({ length: 100 }, () => loads.run('project:tileset:Outside', async () => {
    started++;
    await gate;
    return { pixels: 1024 };
  }));
  assert.equal(calls.every((call) => call === calls[0]), true);
  await Promise.resolve();
  assert.equal(started, 1);
  release();
  const images = await Promise.all(calls);
  assert.equal(images.every((image) => image === images[0]), true);
  assert.equal(started, 1);
  await loads.run('project:tileset:Outside', async () => { started++; return {}; });
  assert.equal(started, 2, 'settled promises must not be retained');
});

test('different assets do not block or substitute for each other', async () => {
  const loads = new InFlightImageLoads();
  const [a, b] = await Promise.all([
    loads.run('project:A', async () => 'A'),
    loads.run('project:B', async () => 'B'),
  ]);
  assert.deepEqual([a, b], ['A', 'B']);
});

test('failed native asset reads are retryable and share the same rejection', async () => {
  const loads = new InFlightImageLoads();
  let attempts = 0;
  const failure = new Error('provider temporarily unavailable');
  const first = loads.run('project:character:Hero', async () => { attempts++; throw failure; });
  const second = loads.run('project:character:Hero', async () => { attempts++; return 'wrong'; });
  assert.equal(first, second);
  assert.deepEqual(await Promise.allSettled([first, second]), [
    { status: 'rejected', reason: failure },
    { status: 'rejected', reason: failure },
  ]);
  assert.equal(attempts, 1);
  assert.equal(await loads.run('project:character:Hero', async () => { attempts++; return 'recovered'; }), 'recovered');
  assert.equal(attempts, 2);
});

test('synchronous loader exceptions are propagated and cleared', async () => {
  const loads = new InFlightImageLoads();
  await assert.rejects(loads.run('broken', () => { throw new Error('sync error'); }), /sync error/);
  assert.equal(await loads.run('broken', async () => 42), 42);
});
