import assert from 'node:assert/strict';
import test from 'node:test';
import { saveSequentially } from '../src/services/saveBatch.ts';

test('map and event writes are serialized rather than racing on one RXDATA file', async () => {
  const order = [];
  let active = false;
  const save = (id) => async () => {
    assert.equal(active, false, `overlapping save: ${id}`);
    active = true;
    order.push(`start:${id}`);
    await new Promise(resolve => setImmediate(resolve));
    order.push(`end:${id}`);
    active = false;
  };
  await saveSequentially([{ id: 'map-1', save: save('map') }, { id: 'event-1', save: save('event') }]);
  assert.deepEqual(order, ['start:map', 'end:map', 'start:event', 'end:event']);
});

test('synchronous and asynchronous failures do not skip remaining editor saves', async () => {
  const saved = [];
  await assert.rejects(
    saveSequentially([
      { id: 'map-1', save: () => { throw new Error('disk full'); } },
      { id: 'event-1', save: async () => { saved.push('event'); } },
      { id: 'pbs-1', save: async () => { throw new Error('permission denied'); } },
      { id: 'script-1', save: async () => { saved.push('script'); } },
    ]),
    error => error.message.includes('Failed to save 2 editor(s)')
      && error.message.includes('map-1: Error: disk full')
      && error.message.includes('pbs-1: Error: permission denied'),
  );
  assert.deepEqual(saved, ['event', 'script']);
});

test('an empty save batch resolves without side effects', async () => {
  await saveSequentially([]);
});
